import json
import re
import sys
import tempfile
import threading
import unittest
from http.cookiejar import CookieJar
from urllib.request import HTTPCookieProcessor, build_opener
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import app


class ExamApplicationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.old_db_path = app.DB_PATH
        self.old_force_error = app.FORCE_DB_ERROR
        app.DB_PATH = Path(self.temp.name) / "test.sqlite3"
        app.FORCE_DB_ERROR = False
        app._sessions.clear()
        app._captcha_challenges.clear()
        app.initialize_database()
        self.server = app.make_server("127.0.0.1", 0)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.server.server_port}"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
        app.DB_PATH = self.old_db_path
        app.FORCE_DB_ERROR = self.old_force_error
        self.temp.cleanup()

    def fetch(self, path):
        with urlopen(self.base + path, timeout=5) as response:
            return response.status, response.headers, response.read()

    def test_notes_returns_expected_json_and_date(self):
        status, headers, body = self.fetch("/notes")
        payload = json.loads(body.decode("utf-8"))
        self.assertEqual(status, 200)
        self.assertIn("application/json", headers.get("Content-Type", ""))
        self.assertGreaterEqual(len(payload), 3)
        self.assertEqual(set(payload[0]), {"id", "title_user", "content", "formatted_date"})
        self.assertRegex(payload[0]["formatted_date"], r"^\d{2}\.\d{2}\.\d{4}$")
        self.assertIn(" - ", payload[0]["title_user"])

    def test_login_page_has_captcha_progress_and_submit_guard(self):
        status, headers, body = self.fetch("/login")
        page = body.decode("utf-8")
        self.assertEqual(status, 200)
        self.assertIn("id=\"puzzle-status\"", page)
        self.assertIn("form.addEventListener('submit'", page)
        self.assertIn("Правильно стоят:", page)
        self.assertIn("Все 9 фрагментов собраны правильно.", page)

    def test_wrong_captcha_counts_as_failed_attempt(self):
        with urlopen(self.base + "/login", timeout=5) as response:
            page = response.read().decode("utf-8")
        challenge = re.search(r'name="captcha_id" value="([^"]+)"', page).group(1)
        form = urlencode({
            "login": "user",
            "password": "User123!",
            "captcha_id": challenge,
            "captcha_order": json.dumps([1, 0, 2, 3, 4, 5, 6, 7, 8]),
        }).encode("utf-8")
        request = Request(self.base + "/login", data=form,
                          headers={"Content-Type": "application/x-www-form-urlencoded"})
        with urlopen(request, timeout=10) as response:
            body = response.read().decode("utf-8")
        self.assertIn("Капча собрана неверно", body)
        connection = app.db_connect()
        try:
            row = connection.execute(
                "SELECT is_blocked, failed_attempts FROM users WHERE login='user'"
            ).fetchone()
            self.assertEqual((row["is_blocked"], row["failed_attempts"]), (0, 1))
        finally:
            connection.close()

    def test_empty_notes_is_successful_empty_array(self):
        connection = app.db_connect()
        try:
            with connection:
                connection.execute("DELETE FROM notes")
        finally:
            connection.close()
        status, headers, body = self.fetch("/notes")
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body.decode("utf-8")), [])
        self.assertIn("application/json", headers.get("Content-Type", ""))

    def test_invalid_limit_returns_400_json(self):
        with self.assertRaises(HTTPError) as caught:
            urlopen(self.base + "/notes?limit=abc", timeout=5)
        self.assertEqual(caught.exception.code, 400)
        self.assertIn("application/json", caught.exception.headers.get("Content-Type", ""))
        self.assertIn("error", json.loads(caught.exception.read().decode("utf-8")))

    def test_database_failure_returns_500_json(self):
        app.FORCE_DB_ERROR = True
        with self.assertRaises(HTTPError) as caught:
            urlopen(self.base + "/notes", timeout=5)
        self.assertEqual(caught.exception.code, 500)
        payload = json.loads(caught.exception.read().decode("utf-8"))
        self.assertEqual(payload["error"], "Ошибка подключения к базе данных")
        self.assertIn("application/json", caught.exception.headers.get("Content-Type", ""))

    def test_three_consecutive_bad_passwords_block_user(self):
        last_body = ""
        for _ in range(3):
            with urlopen(self.base + "/login", timeout=5) as response:
                page = response.read().decode("utf-8")
            challenge = re.search(r'name="captcha_id" value="([^"]+)"', page).group(1)
            form = urlencode({
                "login": "user",
                "password": "definitely-wrong",
                "captcha_id": challenge,
                "captcha_order": json.dumps(list(range(9))),
            }).encode("utf-8")
            request = Request(self.base + "/login", data=form,
                              headers={"Content-Type": "application/x-www-form-urlencoded"})
            with urlopen(request, timeout=10) as response:
                last_body = response.read().decode("utf-8")
        self.assertIn("Вы заблокированы. Обратитесь к администратору", last_body)
        connection = app.db_connect()
        try:
            row = connection.execute("SELECT is_blocked, failed_attempts FROM users WHERE login='user'").fetchone()
            self.assertEqual((row["is_blocked"], row["failed_attempts"]), (1, 3))
        finally:
            connection.close()

    def test_non_get_api_method_returns_405(self):
        request = Request(self.base + "/notes", data=b"", method="POST")
        with self.assertRaises(HTTPError) as caught:
            urlopen(request, timeout=5)
        self.assertEqual(caught.exception.code, 405)
        self.assertEqual(caught.exception.headers.get("Allow"), "GET")
        self.assertIn("application/json", caught.exception.headers.get("Content-Type", ""))

    def test_admin_can_add_edit_and_unlock_users(self):
        opener = build_opener(HTTPCookieProcessor(CookieJar()))
        page = opener.open(self.base + "/login", timeout=5).read().decode("utf-8")
        challenge = re.search(r'name="captcha_id" value="([^"]+)"', page).group(1)
        login_form = urlencode({
            "login": "admin",
            "password": "Admin123!",
            "captcha_id": challenge,
            "captcha_order": json.dumps(list(range(9))),
        }).encode("utf-8")
        request = Request(self.base + "/login", data=login_form,
                          headers={"Content-Type": "application/x-www-form-urlencoded"})
        dashboard = opener.open(request, timeout=10).read().decode("utf-8")
        self.assertIn("Вы успешно авторизовались", dashboard)

        create_form = urlencode({"login": "alice", "password": "Alice123!", "role": "Пользователь"}).encode("utf-8")
        create_request = Request(self.base + "/admin/users/create", data=create_form,
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
        created = opener.open(create_request, timeout=10).read().decode("utf-8")
        self.assertIn("Пользователь «alice» добавлен", created)

        connection = app.db_connect()
        try:
            user_id = connection.execute("SELECT id FROM users WHERE login='user'").fetchone()["id"]
        finally:
            connection.close()
        edit_form = urlencode({"user_id": user_id, "login": "user-renamed", "role": "Пользователь",
                               "is_blocked": 1, "new_password": ""}).encode("utf-8")
        edit_request = Request(self.base + "/admin/users/update", data=edit_form,
                               headers={"Content-Type": "application/x-www-form-urlencoded"})
        edited = opener.open(edit_request, timeout=10).read().decode("utf-8")
        self.assertIn("Данные пользователя «user-renamed» обновлены", edited)
        connection = app.db_connect()
        try:
            row = connection.execute("SELECT is_blocked FROM users WHERE login='user-renamed'").fetchone()
            self.assertEqual(row["is_blocked"], 1)
        finally:
            connection.close()

        unlock_form = urlencode({"user_id": user_id, "login": "user-renamed", "role": "Пользователь",
                                 "is_blocked": 0, "new_password": ""}).encode("utf-8")
        unlock_request = Request(self.base + "/admin/users/update", data=unlock_form,
                                 headers={"Content-Type": "application/x-www-form-urlencoded"})
        opener.open(unlock_request, timeout=10).read()
        connection = app.db_connect()
        try:
            row = connection.execute("SELECT is_blocked, failed_attempts FROM users WHERE login='user-renamed'").fetchone()
            self.assertEqual((row["is_blocked"], row["failed_attempts"]), (0, 0))
        finally:
            connection.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
