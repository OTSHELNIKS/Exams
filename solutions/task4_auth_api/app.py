from __future__ import annotations

import hashlib
import hmac
import html
import json
import os
import re
import secrets
import sqlite3
import threading
import time
from datetime import date
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlencode, urlsplit

APP_DIR = Path(__file__).resolve().parent
STATIC_DIR = APP_DIR / "static"
DB_PATH = Path(os.environ.get("EXAM_DB_PATH", APP_DIR / "exam_app.sqlite3")).resolve()
APP_PORT = int(os.environ.get("APP_PORT", "8000"))
PBKDF2_ROUNDS = 240_000
SESSION_TTL_SECONDS = 8 * 60 * 60
MAX_FORM_BYTES = 32_768
CAPTCHA_SIZE = 9


FORCE_DB_ERROR = (
    os.environ.get("EXAM_TEST_MODE") == "1"
    and os.environ.get("EXAM_FORCE_DB_ERROR") == "1"
)
_sessions: dict[str, dict[str, Any]] = {}
_captcha_challenges: dict[str, float] = {}
_state_lock = threading.Lock()


SCHEMA = """
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    login TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_salt TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('Администратор', 'Пользователь')),
    is_blocked INTEGER NOT NULL DEFAULT 0 CHECK (is_blocked IN (0, 1)),
    failed_attempts INTEGER NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_user_date ON notes(user_id, created_at DESC);
"""


def db_connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(str(DB_PATH), timeout=5)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 5000")
    return connection


def make_password_hash(password: str, salt_hex: str | None = None) -> tuple[str, str]:
    salt_hex = salt_hex or secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), PBKDF2_ROUNDS
    ).hex()
    return salt_hex, digest


def password_matches(password: str, salt_hex: str, expected_hash: str) -> bool:
    _, actual = make_password_hash(password, salt_hex)
    return hmac.compare_digest(actual, expected_hash)


def initialize_database() -> None:

    connection = db_connect()
    try:
        connection.executescript(SCHEMA)
        with connection:
            count = connection.execute("SELECT COUNT(*) FROM users").fetchone()[0]
            if count == 0:
                for login, password, role in (
                    ("admin", os.environ.get("EXAM_ADMIN_PASSWORD", "Admin123!"), "Администратор"),
                    ("user", os.environ.get("EXAM_USER_PASSWORD", "User123!"), "Пользователь"),
                ):
                    salt, digest = make_password_hash(password)
                    connection.execute(
                        """INSERT INTO users(login, password_salt, password_hash, role)
                           VALUES (?, ?, ?, ?)""",
                        (login, salt, digest, role),
                    )
            if connection.execute("SELECT COUNT(*) FROM notes").fetchone()[0] == 0:
                users = {row["login"]: row["id"] for row in connection.execute(
                    "SELECT id, login FROM users WHERE login IN ('admin', 'user')"
                )}
                demo_notes = [
                    ("Планирование", "Согласовать сроки подготовки проекта.", "admin", "2026-10-01"),
                    ("Встреча", "Подготовить повестку и материалы к встрече.", "user", "2026-10-02"),
                    ("Заметки по API", "Проверить формат JSON и коды ответов.", "admin", "2026-10-03"),
                    ("Проверка базы", "Убедиться, что внешние ключи включены.", "user", "2026-10-04"),
                    ("Итоги", "Сохранить результаты тестирования.", "admin", "2026-10-05"),
                ]
                for title, content, login, created_at in demo_notes:
                    if login in users:
                        connection.execute(
                            "INSERT INTO notes(title, content, user_id, created_at) VALUES (?, ?, ?, ?)",
                            (title, content, users[login], created_at),
                        )
    finally:
        connection.close()


def _fetch_user(login: str) -> sqlite3.Row | None:
    connection = db_connect()
    try:
        return connection.execute(
            "SELECT * FROM users WHERE login = ? COLLATE NOCASE", (login,)
        ).fetchone()
    finally:
        connection.close()


def _record_failed_attempt(login: str) -> bool:

    if not login:
        return False
    connection = db_connect()
    try:
        with connection:
            connection.execute(
                """UPDATE users
                   SET failed_attempts = failed_attempts + 1,
                       is_blocked = CASE WHEN failed_attempts + 1 >= 3 THEN 1 ELSE 0 END
                   WHERE login = ? COLLATE NOCASE AND is_blocked = 0""",
                (login,),
            )
            row = connection.execute(
                "SELECT is_blocked FROM users WHERE login = ? COLLATE NOCASE", (login,)
            ).fetchone()
            return bool(row and row["is_blocked"])
    finally:
        connection.close()


def _reset_failed_attempts(user_id: int) -> None:
    connection = db_connect()
    try:
        with connection:
            connection.execute(
                "UPDATE users SET failed_attempts = 0 WHERE id = ?", (user_id,)
            )
    finally:
        connection.close()


def _read_form(handler: BaseHTTPRequestHandler) -> dict[str, str]:
    try:
        length = int(handler.headers.get("Content-Length", "0"))
    except ValueError:
        return {}
    if length < 0 or length > MAX_FORM_BYTES:
        return {}
    raw = handler.rfile.read(length).decode("utf-8", errors="replace")
    return {key: values[-1] for key, values in parse_qs(raw, keep_blank_values=True).items()}


def _parse_captcha_order(value: str) -> list[int] | None:
    try:
        parsed = json.loads(value)
        if not isinstance(parsed, list) or len(parsed) != CAPTCHA_SIZE:
            return None
        if any(type(item) is not int for item in parsed):
            return None
        if sorted(parsed) != list(range(CAPTCHA_SIZE)):
            return None
        return parsed
    except (json.JSONDecodeError, TypeError):
        return None


def _clean_expired_state() -> None:
    now = time.time()
    with _state_lock:
        for token in [key for key, value in _captcha_challenges.items() if value < now]:
            _captcha_challenges.pop(token, None)
        for token in [key for key, value in _sessions.items() if value["expires"] < now]:
            _sessions.pop(token, None)


class ExamRequestHandler(BaseHTTPRequestHandler):
    server_version = "ExamDemo/1.0"

    def log_message(self, fmt: str, *args: Any) -> None:

        super().log_message(fmt, *args)

    def _common_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cache-Control", "no-store")

    def _send_html(self, body: str, status: int = 200, extra_headers: list[tuple[str, str]] | None = None) -> None:
        encoded = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self._common_headers()
        for key, value in extra_headers or []:
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(encoded)

    def _send_json(self, payload: Any, status: int = 200, extra_headers: list[tuple[str, str]] | None = None) -> None:
        encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self._common_headers()
        for key, value in extra_headers or []:
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(encoded)

    def _redirect(self, location: str, cookie: str | None = None) -> None:
        self.send_response(HTTPStatus.SEE_OTHER)
        self.send_header("Location", location)
        self.send_header("Content-Length", "0")
        self._common_headers()
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()

    def _current_user(self) -> sqlite3.Row | None:
        _clean_expired_state()
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
        except Exception:
            return None
        morsel = cookie.get("sid")
        if not morsel:
            return None
        with _state_lock:
            session = _sessions.get(morsel.value)
        if not session or session["expires"] < time.time():
            return None
        return _fetch_user_by_id(session["user_id"])

    def do_GET(self) -> None:
        parsed = urlsplit(self.path)
        path = parsed.path
        if path in ("/notes", "/api/notes"):
            self._get_notes(parsed.query)
            return
        if path == "/static/captcha_full.png":
            asset = STATIC_DIR / "captcha_full.png"
            try:
                data = asset.read_bytes()
            except OSError:
                self._send_html(_page("Ошибка", "Файл изображения капчи не найден."), 500)
                return
            self.send_response(200)
            self.send_header("Content-Type", "image/png")
            self.send_header("Content-Length", str(len(data)))
            self._common_headers()
            self.end_headers()
            self.wfile.write(data)
            return
        if path in ("/", "/login"):
            user = self._current_user()
            if user:
                self._redirect("/dashboard")
            else:
                self._login_page()
            return
        if path == "/dashboard":
            user = self._current_user()
            if not user:
                self._redirect("/login")
            else:
                welcome = parse_qs(parsed.query).get("welcome", [""])[0] == "1"
                self._dashboard(user, welcome=welcome)
            return
        if path == "/admin/users":
            user = self._current_user()
            if not user:
                self._redirect("/login")
            elif user["role"] != "Администратор":
                self._send_html(_page("Доступ запрещён", "Эта страница доступна только администратору."), 403)
            else:
                self._admin_page(user)
            return
        self._send_html(_page("Не найдено", "Страница не найдена."), 404)

    def do_POST(self) -> None:
        path = urlsplit(self.path).path
        if path in ("/notes", "/api/notes"):
            self._send_json({"error": "Метод не поддерживается. Используйте GET."}, 405,
                            [("Allow", "GET")])
            return
        if path == "/login":
            self._login(_read_form(self))
            return
        if path == "/logout":
            self._logout()
            return
        if path == "/admin/users/create":
            self._admin_create_user(_read_form(self))
            return
        if path == "/admin/users/update":
            self._admin_update_user(_read_form(self))
            return
        self._send_html(_page("Не найдено", "Страница не найдена."), 404)

    def _get_notes(self, raw_query: str) -> None:

        query = parse_qs(raw_query, keep_blank_values=True)
        allowed = {"limit", "user_id"}
        unknown = sorted(set(query) - allowed)
        if unknown:
            self._send_json({"error": "Неизвестный параметр: " + ", ".join(unknown)}, 400)
            return
        if any(len(values) != 1 for values in query.values()):
            self._send_json({"error": "Каждый параметр можно передать только один раз."}, 400)
            return

        limit: int | None = None
        user_id: int | None = None
        try:
            if "limit" in query:
                limit = int(query["limit"][0])
                if not 1 <= limit <= 1000:
                    raise ValueError
            if "user_id" in query:
                user_id = int(query["user_id"][0])
                if user_id <= 0:
                    raise ValueError
        except ValueError:
            self._send_json(
                {"error": "Параметры limit и user_id должны быть положительными целыми числами; limit — от 1 до 1000."},
                400,
            )
            return

        connection: sqlite3.Connection | None = None
        try:
            if FORCE_DB_ERROR:
                raise sqlite3.OperationalError("Тестовая имитация сбоя подключения к БД")
            connection = db_connect()
            sql = """SELECT n.id, n.title, n.content, n.created_at, u.login
                     FROM notes AS n JOIN users AS u ON u.id = n.user_id"""
            conditions: list[str] = []
            parameters: list[Any] = []
            if user_id is not None:
                conditions.append("n.user_id = ?")
                parameters.append(user_id)
            if conditions:
                sql += " WHERE " + " AND ".join(conditions)
            sql += " ORDER BY n.created_at DESC, n.id DESC"
            if limit is not None:
                sql += " LIMIT ?"
                parameters.append(limit)
            rows = connection.execute(sql, parameters).fetchall()
            result = []
            for row in rows:
                created = date.fromisoformat(str(row["created_at"])[:10])
                result.append({
                    "id": int(row["id"]),
                    "title_user": f"{row['title']} - {row['login']}",
                    "content": row["content"],
                    "formatted_date": created.strftime("%d.%m.%Y"),
                })
            self._send_json(result, 200)
        except Exception as error:

            print(f"Ошибка GET /notes: {type(error).__name__}: {error}", flush=True)
            self._send_json({"error": "Ошибка подключения к базе данных"}, 500)
        finally:
            if connection is not None:
                connection.close()

    def _login_page(self, message: str = "", login_value: str = "", success: bool = False) -> None:
        _clean_expired_state()
        challenge_id = secrets.token_urlsafe(18)
        initial_order = list(range(CAPTCHA_SIZE))

        import random
        random.SystemRandom().shuffle(initial_order)
        with _state_lock:
            _captcha_challenges[challenge_id] = time.time() + 5 * 60
        tiles = []
        for piece in initial_order:
            x, y = piece % 3, piece // 3
            tiles.append(
                f'<button type="button" class="puzzle-piece" draggable="true" '
                f'data-piece="{piece}" aria-label="Фрагмент {piece + 1}" '
                f'style="background-position:{x * 50}% {y * 50}%"></button>'
            )
        notice_class = "notice success" if success else "notice error"
        if success:
            notice_title, notice_icon = "Информация", "✓"
        elif "заблокированы" in message.lower():
            notice_title, notice_icon = "Блокировка", "🔒"
        elif "капча" in message.lower():
            notice_title, notice_icon = "Проверка", "⚠"
        else:
            notice_title, notice_icon = "Ошибка", "⚠"
        notice = (f'<div class="{notice_class}" role="status"><strong>{notice_icon} '
                  f'{notice_title}</strong><br>{html.escape(message)}</div>') if message else ""
        safe_login = html.escape(login_value, quote=True)
        initial_json = html.escape(json.dumps(initial_order), quote=True)
        body = f"""<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Авторизация</title><style>
:root{{--ink:#172033;--blue:#4058d6;--muted:#67718a;--line:#dce2ee;--paper:#fff;--bg:#f3f6fb}}
*{{box-sizing:border-box}}body{{margin:0;background:linear-gradient(140deg,#edf2ff,#f8fbff 52%,#eef8f6);font:16px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);min-height:100vh;display:grid;place-items:center;padding:22px}}
.card{{width:min(100%,510px);background:var(--paper);border:1px solid #e5e9f2;border-radius:22px;box-shadow:0 20px 60px #25366618;padding:30px}}
.kicker{{color:var(--blue);font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}}
h1{{font-size:28px;margin:7px 0 4px}}.muted{{color:var(--muted);margin:0 0 22px}}label{{display:block;font-weight:650;margin:14px 0 6px}}
input[type=text],input[type=password]{{width:100%;border:1px solid var(--line);border-radius:11px;padding:12px 13px;font:inherit;outline:none}}
input:focus{{border-color:var(--blue);box-shadow:0 0 0 3px #4058d61c}}.notice{{padding:11px 13px;border-radius:10px;margin:12px 0}}.error{{background:#fff0ee;color:#a1251b}}.success{{background:#e9f8ee;color:#166534}}
.puzzle-wrap{{margin:10px 0 15px;padding:14px;background:#f5f7fc;border:1px solid var(--line);border-radius:14px}}
.puzzle-instruction{{margin:0 0 11px;font-size:13px;color:var(--muted)}}.puzzle{{display:grid;grid-template-columns:repeat(3,76px);gap:4px;justify-content:center;touch-action:manipulation}}
.puzzle-piece{{width:76px;height:76px;border:1px solid #8091b7;border-radius:6px;background-color:#edf4ff;background-image:url('/static/captcha_full.png');background-size:300% 300%;cursor:grab;padding:0;transition:transform .12s,border-color .12s}}
.puzzle-piece:hover{{border:2px solid var(--blue)}}.puzzle-piece.selected{{outline:3px solid #4058d6;outline-offset:1px;transform:scale(.96)}}
button.submit{{width:100%;margin-top:13px;border:0;border-radius:11px;padding:13px;background:var(--blue);color:white;font:inherit;font-weight:750;cursor:pointer}}
button.submit:hover{{background:#3248c3}}.footer{{margin-top:18px;padding-top:14px;border-top:1px solid var(--line);font-size:12px;color:var(--muted)}}
@media(max-width:420px){{.card{{padding:22px}}.puzzle{{grid-template-columns:repeat(3,64px)}}.puzzle-piece{{width:64px;height:64px}}}}
</style></head><body><main class="card"><div class="kicker">Система управления</div><h1>Вход в систему</h1>
<p class="muted">Введите учётные данные и соберите изображение из фрагментов.</p>{notice}
<form method="post" action="/login" autocomplete="on">
<label for="login">Логин</label><input id="login" name="login" type="text" minlength="1" maxlength="32" required autocomplete="username" value="{safe_login}">
<label for="password">Пароль</label><input id="password" name="password" type="password" required autocomplete="current-password">
<div class="puzzle-wrap"><p class="puzzle-instruction">Нажмите на два фрагмента, чтобы поменять их местами, или перетащите фрагмент. Соберите исходную картинку.</p>
<div class="puzzle" id="puzzle" aria-label="Интерактивная капча">{''.join(tiles)}</div></div>
<input type="hidden" name="captcha_id" value="{challenge_id}">
<input type="hidden" id="captcha_order" name="captcha_order" value="{initial_json}">
<button class="submit" type="submit">Войти</button></form>
<div class="footer">После трёх последовательных ошибок учётная запись блокируется. Обратитесь к администратору для снятия блокировки.</div>
</main><script>
(()=>{{const board=document.getElementById('puzzle'),out=document.getElementById('captcha_order');let selected=null,dragged=null;
function save(){{out.value=JSON.stringify([...board.children].map(tile=>Number(tile.dataset.piece)))}}
function swap(a,b){{if(!a||!b||a===b)return;const marker=document.createElement('span');board.insertBefore(marker,a);board.insertBefore(a,b);board.insertBefore(b,marker);marker.remove();a.classList.remove('selected');b.classList.remove('selected');selected=null;save()}}
board.querySelectorAll('.puzzle-piece').forEach(tile=>{{tile.addEventListener('click',()=>{{if(!selected){{selected=tile;tile.classList.add('selected')}}else if(selected===tile){{tile.classList.remove('selected');selected=null}}else swap(selected,tile)}});
tile.addEventListener('dragstart',e=>{{dragged=tile;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',tile.dataset.piece)}});
tile.addEventListener('dragover',e=>e.preventDefault());tile.addEventListener('drop',e=>{{e.preventDefault();const source=[...board.children].find(x=>x.dataset.piece===e.dataTransfer.getData('text/plain'));swap(source,tile)}})}});save()}})();
</script></body></html>"""
        self._send_html(body)

    def _login(self, form: dict[str, str]) -> None:
        login = form.get("login", "").strip().casefold()
        password = form.get("password", "")
        user = _fetch_user(login) if login else None
        if user and user["is_blocked"]:
            self._login_page("Вы заблокированы. Обратитесь к администратору", login)
            return

        challenge_id = form.get("captcha_id", "")
        with _state_lock:
            expires = _captcha_challenges.pop(challenge_id, None)
        captcha_order = _parse_captcha_order(form.get("captcha_order", ""))
        captcha_valid = expires is not None and expires >= time.time() and captcha_order == list(range(CAPTCHA_SIZE))
        if not captcha_valid:
            locked = _record_failed_attempt(login)
            message = (
                "Вы заблокированы. Обратитесь к администратору"
                if locked else "Капча собрана неверно или время её действия истекло. Переставьте фрагменты и попробуйте снова."
            )
            self._login_page(message, login)
            return

        correct_password = bool(
            user and password_matches(password, user["password_salt"], user["password_hash"])
        )
        if not user or not correct_password:
            locked = _record_failed_attempt(login)
            message = (
                "Вы заблокированы. Обратитесь к администратору"
                if locked else "Вы ввели неверный логин или пароль. Пожалуйста проверьте ещё раз введенные данные"
            )
            self._login_page(message, login)
            return

        _reset_failed_attempts(int(user["id"]))
        session_id = secrets.token_urlsafe(32)
        with _state_lock:
            _sessions[session_id] = {
                "user_id": int(user["id"]),
                "expires": time.time() + SESSION_TTL_SECONDS,
            }
        cookie = f"sid={session_id}; Path=/; HttpOnly; SameSite=Lax; Max-Age={SESSION_TTL_SECONDS}"

        self._redirect("/dashboard?welcome=1", cookie)

    def _dashboard(self, user: sqlite3.Row, welcome: bool = False) -> None:
        login = html.escape(user["login"])
        role = html.escape(user["role"])
        banner = '<div class="notice success">Вы успешно авторизовались</div>' if welcome else ""
        admin_link = '<p><a class="button secondary" href="/admin/users">Управление пользователями</a></p>' if user["role"] == "Администратор" else ""
        body = f"""<main class="card"><div class="kicker">Рабочий стол</div><h1>Здравствуйте, {login}</h1>{banner}
<p>Роль: <strong>{role}</strong></p><p>API заметок: <a href="/notes">GET /notes</a></p>{admin_link}
<form method="post" action="/logout"><button class="button" type="submit">Выйти</button></form></main>"""
        self._send_html(_page("Рабочий стол", body, styled=True))

    def _logout(self) -> None:
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
        except Exception:
            cookie = SimpleCookie()
        morsel = cookie.get("sid")
        if morsel:
            with _state_lock:
                _sessions.pop(morsel.value, None)
        self._redirect("/login", "sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0")

    def _admin_page(self, current_user: sqlite3.Row, message: str = "", is_error: bool = False) -> None:
        connection = db_connect()
        try:
            users = connection.execute(
                "SELECT id, login, role, is_blocked, failed_attempts FROM users ORDER BY id"
            ).fetchall()
        finally:
            connection.close()
        banner = ""
        if message:
            cls = "notice error" if is_error else "notice success"
            title = "⚠ Ошибка" if is_error else "✓ Информация"
            banner = f'<div class="{cls}" role="status"><strong>{title}</strong><br>{html.escape(message)}</div>'
        rows = []
        for user in users:
            role_options = "".join(
                f'<option value="{role}"{" selected" if user["role"] == role else ""}>{role}</option>'
                for role in ("Пользователь", "Администратор")
            )
            blocked_options = (
                f'<option value="0"{" selected" if not user["is_blocked"] else ""}>Активна</option>'
                f'<option value="1"{" selected" if user["is_blocked"] else ""}>Заблокирована</option>'
            )
            rows.append(f"""<tr><td>{int(user['id'])}</td><td>{html.escape(user['login'])}</td>
<td>{int(user['failed_attempts'])}</td><td><form class="edit" method="post" action="/admin/users/update">
<input type="hidden" name="user_id" value="{int(user['id'])}"><input name="login" value="{html.escape(user['login'], quote=True)}" required minlength="1" maxlength="32" pattern="[A-Za-zА-Яа-яЁё0-9._-]+" aria-label="Логин">
<select name="role">{role_options}</select><select name="is_blocked">{blocked_options}</select>
<input name="new_password" type="password" minlength="8" placeholder="Новый пароль (необязательно)">
<button class="button small" type="submit">Сохранить</button></form></td></tr>""")
        table_rows = "".join(rows)
        body = f"""<main class="wrap"><a href="/dashboard">← Рабочий стол</a><div class="kicker">Администрирование</div>
<h1>Пользователи</h1>{banner}<section class="panel"><h2>Добавить пользователя</h2>
<form class="create" method="post" action="/admin/users/create"><label>Логин<input name="login" required minlength="1" maxlength="32" pattern="[A-Za-zА-Яа-яЁё0-9._-]+"></label>
<label>Пароль<input name="password" type="password" required minlength="8"></label><label>Роль<select name="role"><option>Пользователь</option><option>Администратор</option></select></label>
<button class="button" type="submit">Добавить</button></form></section>
<section class="panel"><h2>Текущие учётные записи</h2><div class="table-scroll"><table><thead><tr><th>ID</th><th>Логин</th><th>Ошибки</th><th>Роль / блокировка / пароль</th></tr></thead><tbody>{table_rows}</tbody></table></div></section></main>"""
        self._send_html(_page("Управление пользователями", body, styled=True, admin=True))

    def _authorized_admin(self) -> sqlite3.Row | None:
        user = self._current_user()
        if not user or user["role"] != "Администратор":
            return None
        return user

    def _admin_create_user(self, form: dict[str, str]) -> None:
        admin = self._authorized_admin()
        if not admin:
            self._send_html(_page("Доступ запрещён", "Войдите под учётной записью администратора."), 403)
            return
        login = form.get("login", "").strip().casefold()
        password = form.get("password", "")
        role = form.get("role", "")
        if not re.fullmatch(r"[A-Za-zА-Яа-яЁё0-9._-]{1,32}", login):
            self._admin_page(admin, "Логин: 1–32 буквы, цифры, точка, дефис или подчёркивание.", True)
            return
        if len(password) < 8:
            self._admin_page(admin, "Пароль должен содержать не менее 8 символов.", True)
            return
        if role not in ("Пользователь", "Администратор"):
            self._admin_page(admin, "Выберите допустимую роль.", True)
            return
        salt, digest = make_password_hash(password)
        connection = db_connect()
        try:
            with connection:
                connection.execute(
                    "INSERT INTO users(login, password_salt, password_hash, role) VALUES (?, ?, ?, ?)",
                    (login, salt, digest, role),
                )
            self._admin_page(admin, f"Пользователь «{login}» добавлен.")
        except sqlite3.IntegrityError:
            self._admin_page(admin, "Пользователь с указанным логином уже существует. Выберите другой логин.", True)
        finally:
            connection.close()

    def _admin_update_user(self, form: dict[str, str]) -> None:
        admin = self._authorized_admin()
        if not admin:
            self._send_html(_page("Доступ запрещён", "Войдите под учётной записью администратора."), 403)
            return
        try:
            user_id = int(form.get("user_id", ""))
            blocked = int(form.get("is_blocked", ""))
        except ValueError:
            self._admin_page(admin, "Некорректный идентификатор или статус блокировки.", True)
            return
        login = form.get("login", "").strip().casefold()
        role = form.get("role", "")
        new_password = form.get("new_password", "")
        if not re.fullmatch(r"[A-Za-zА-Яа-яЁё0-9._-]{1,32}", login):
            self._admin_page(admin, "Логин: 1–32 буквы, цифры, точка, дефис или подчёркивание.", True)
            return
        if user_id <= 0 or blocked not in (0, 1) or role not in ("Пользователь", "Администратор"):
            self._admin_page(admin, "Проверьте ID, логин, роль и статус блокировки.", True)
            return
        if new_password and len(new_password) < 8:
            self._admin_page(admin, "Новый пароль должен содержать не менее 8 символов.", True)
            return
        if user_id == int(admin["id"]) and (blocked or role != "Администратор"):
            self._admin_page(admin, "Нельзя заблокировать или лишить роли текущую учётную запись администратора.", True)
            return

        connection = db_connect()
        try:
            target = connection.execute("SELECT id, login FROM users WHERE id = ?", (user_id,)).fetchone()
            if not target:
                self._admin_page(admin, "Пользователь не найден. Обновите страницу и повторите действие.", True)
                return
            with connection:
                if new_password:
                    salt, digest = make_password_hash(new_password)
                    connection.execute(
                        """UPDATE users SET login = ?, role = ?, is_blocked = ?, failed_attempts = 0,
                           password_salt = ?, password_hash = ? WHERE id = ?""",
                        (login, role, blocked, salt, digest, user_id),
                    )
                else:
                    connection.execute(
                        """UPDATE users SET login = ?, role = ?, is_blocked = ?,
                           failed_attempts = CASE WHEN ? = 0 THEN 0 ELSE failed_attempts END
                           WHERE id = ?""",
                        (login, role, blocked, blocked, user_id),
                    )
            self._admin_page(admin, f"Данные пользователя «{login}» обновлены.")
        except sqlite3.IntegrityError:
            self._admin_page(admin, "Пользователь с указанным логином уже существует. Укажите уникальный логин.", True)
        finally:
            connection.close()


def _fetch_user_by_id(user_id: int) -> sqlite3.Row | None:
    connection = db_connect()
    try:
        return connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    finally:
        connection.close()


def _page(title: str, body: str, styled: bool = False, admin: bool = False) -> str:
    if not styled:
        return f"""<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{html.escape(title)}</title></head><body><h1>{html.escape(title)}</h1>{body}</body></html>"""
    extra = """
<style>
:root{--ink:#172033;--blue:#4058d6;--muted:#67718a;--line:#dce2ee;--paper:#fff;--bg:#f3f6fb}
*{box-sizing:border-box}body{margin:0;background:var(--bg);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);padding:28px}
.card,.wrap{max-width:900px;margin:5vh auto;background:white;border:1px solid #e5e9f2;border-radius:20px;padding:28px;box-shadow:0 16px 50px #25366614}
.wrap{max-width:1150px;margin:0 auto}.kicker{color:var(--blue);font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}h1{margin:7px 0 20px;font-size:28px}h2{font-size:18px;margin:0 0 12px}
a{color:var(--blue)}.button{display:inline-block;border:0;border-radius:9px;padding:10px 15px;background:var(--blue);color:#fff;text-decoration:none;font:inherit;font-weight:700;cursor:pointer}
.button.secondary{background:#e9edff;color:#3046bd}.button.small{padding:8px 11px;font-size:13px}.notice{padding:11px 13px;border-radius:10px;margin:12px 0}.success{background:#e9f8ee;color:#166534}.error{background:#fff0ee;color:#a1251b}
.panel{background:#fff;border:1px solid var(--line);border-radius:14px;padding:18px;margin:16px 0}.create{display:flex;gap:12px;align-items:end;flex-wrap:wrap}.create label{display:grid;gap:5px;font-weight:650}.create input,.create select,.edit input,.edit select{border:1px solid var(--line);border-radius:8px;padding:8px 10px;font:inherit}
.table-scroll{overflow:auto}table{width:100%;border-collapse:collapse;min-width:760px}th,td{text-align:left;padding:10px;border-bottom:1px solid var(--line);vertical-align:middle}th{font-size:13px;color:var(--muted)}.edit{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
</style>""" if admin else """
<style>
:root{--ink:#172033;--blue:#4058d6;--bg:#f3f6fb}*{box-sizing:border-box}body{margin:0;background:var(--bg);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--ink);padding:22px}
.card{max-width:620px;margin:9vh auto;background:white;border:1px solid #e5e9f2;border-radius:20px;padding:30px;box-shadow:0 16px 50px #25366614}.kicker{color:var(--blue);font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}h1{margin:7px 0 20px;font-size:28px}
a{color:var(--blue)}.button{display:inline-block;border:0;border-radius:9px;padding:10px 15px;background:var(--blue);color:#fff;text-decoration:none;font:inherit;font-weight:700;cursor:pointer}.button.secondary{background:#e9edff;color:#3046bd}.notice{padding:11px 13px;border-radius:10px;margin:12px 0}.success{background:#e9f8ee;color:#166534}
</style>"""
    return f"<!doctype html><html lang='ru'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>{html.escape(title)}</title>{extra}</head><body>{body}</body></html>"


def make_server(host: str = "127.0.0.1", port: int = APP_PORT) -> ThreadingHTTPServer:
    return ThreadingHTTPServer((host, port), ExamRequestHandler)


def main() -> None:
    initialize_database()
    server = make_server("0.0.0.0", APP_PORT)
    print(f"Сервер запущен: http://127.0.0.1:{APP_PORT}")
    print("Демо-входы: admin / Admin123! и user / User123! (поменяйте перед реальным использованием)")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nОстановка сервера...")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
