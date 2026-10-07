from __future__ import annotations

import argparse
import json
import sqlite3
from collections import Counter
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
REPO_ROOT = HERE.parents[1]
SYNTHETIC_ID_BASE = 1_000_000_000


def read_records(path: Path) -> list[dict[str, Any]]:
    with path.open("r", encoding="utf-8-sig") as stream:
        value = json.load(stream)
    if isinstance(value, list):
        return value
    if isinstance(value, dict) and isinstance(value.get("records"), list):
        return value["records"]
    raise ValueError(f"Неожиданный формат JSON: {path.name}")


def allocate_surrogate(used_ids: set[int], counter: list[int]) -> int:
    while counter[0] in used_ids:
        counter[0] += 1
    result = counter[0]
    used_ids.add(result)
    counter[0] += 1
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description='Загрузка предоставленных JSON-данных в manufacturing.sqlite3.')
    parser.add_argument("--data-dir", type=Path, default=REPO_ROOT,
                        help="папка с исходными JSON (по умолчанию корень проекта)")
    parser.add_argument("--db-path", type=Path, default=HERE / "manufacturing.sqlite3",
                        help="путь создаваемой базы SQLite")
    args = parser.parse_args()
    data_dir = args.data_dir.resolve()
    db_path = args.db_path.resolve()
    db_path.parent.mkdir(parents=True, exist_ok=True)

    source_names = [
        "Заказчики.json", "Заказы.json", "Позиции_заказов.json", "Товары.json",
        "Материалы.json", "Спецификация.json", "Цены.json", "Скидки.json",
    ]
    missing_files = [name for name in source_names if not (data_dir / name).is_file()]
    if missing_files:
        raise FileNotFoundError("Не найдены исходные файлы: " + ", ".join(missing_files))

    data = {name: read_records(data_dir / name) for name in source_names}
    customers = data["Заказчики.json"]
    orders = data["Заказы.json"]
    order_items = data["Позиции_заказов.json"]
    products = data["Товары.json"]
    resources = data["Материалы.json"]
    specification = data["Спецификация.json"]
    price_rows = data["Цены.json"]
    discount_rows = data["Скидки.json"]


    known_product_source_ids = {int(row["id"]) for row in products}
    referenced_product_ids = {int(row["product_id"]) for row in order_items}
    referenced_product_ids.update(int(row["product_id"]) for row in specification)
    for rows in (price_rows, discount_rows):
        referenced_product_ids.update(
            int(row["item_id"]) for row in rows if row["item_type"] == "Товар"
        )
    missing_product_ids = sorted(referenced_product_ids - known_product_source_ids)


    duplicate_product_ids = sorted(
        source_id for source_id, count in Counter(int(row["id"]) for row in products).items()
        if count > 1
    )
    duplicate_resource_ids = sorted(
        source_id for source_id, count in Counter(int(row["id"]) for row in resources).items()
        if count > 1
    )
    duplicate_order_item_ids = sorted(
        source_id for source_id, count in Counter(int(row["id"]) for row in order_items).items()
        if count > 1
    )
    duplicate_discount_ids = sorted(
        source_id for source_id, count in Counter(int(row["id"]) for row in discount_rows).items()
        if count > 1
    )

    product_ref: dict[int, int] = {}
    used_product_ids: set[int] = set()
    surrogate_counter = [SYNTHETIC_ID_BASE]
    product_values = []
    for row in products:
        source_id = int(row["id"])
        internal_id = source_id if source_id not in used_product_ids else allocate_surrogate(used_product_ids, surrogate_counter)
        used_product_ids.add(internal_id)
        product_ref.setdefault(source_id, internal_id)
        product_values.append((internal_id, source_id, row["name"], row.get("category", "") or "", 0))
    for source_id in missing_product_ids:
        internal_id = source_id if source_id not in used_product_ids else allocate_surrogate(used_product_ids, surrogate_counter)
        used_product_ids.add(internal_id)
        product_ref[source_id] = internal_id
        product_values.append((internal_id, source_id,
                               f"[Нет в исходном справочнике: product_id={source_id}]", "", 1))

    resource_ref: dict[int, int] = {}
    typed_resource_ref: dict[tuple[int, str], int] = {}
    used_resource_ids: set[int] = set()
    resource_values = []
    for row in resources:
        source_id = int(row["id"])
        resource_type = row["type"]
        internal_id = source_id if source_id not in used_resource_ids else allocate_surrogate(used_resource_ids, surrogate_counter)
        used_resource_ids.add(internal_id)
        resource_ref.setdefault(source_id, internal_id)
        typed_resource_ref.setdefault((source_id, resource_type), internal_id)
        resource_values.append((internal_id, source_id, row["name"], resource_type))

    schema = (HERE / "schema.sql").read_text(encoding="utf-8")
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        connection.executescript(schema)
        with connection:

            for table in (
                "prices", "discounts", "order_items", "production_order_items",
                "customer_orders", "product_specification", "production_orders",
                "resources", "products", "customers",
            ):
                connection.execute(f"DELETE FROM {table}")

            connection.executemany(
                """INSERT INTO customers
                   (customer_id, name, inn, address, phone, party_type)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                [(
                    str(row["id"]), row.get("name", ""), row.get("inn", "") or "",
                    row.get("addres", row.get("address", "")) or "",
                    row.get("phone", "") or "", row.get("type", "Прочее"),
                ) for row in customers],
            )
            connection.executemany(
                """INSERT INTO products
                   (product_id, source_product_id, name, category, is_placeholder)
                   VALUES (?, ?, ?, ?, ?)""",
                product_values,
            )
            connection.executemany(
                """INSERT INTO resources
                   (resource_id, source_resource_id, name, resource_type)
                   VALUES (?, ?, ?, ?)""",
                resource_values,
            )
            connection.executemany(
                """INSERT INTO product_specification
                   (specification_id, product_id, resource_id, quantity_per_product)
                   VALUES (?, ?, ?, ?)""",
                [(int(row["id"]), product_ref[int(row["product_id"])],
                  resource_ref[int(row["material_id"])], float(row["qty"]))
                 for row in specification],
            )
            connection.executemany(
                """INSERT INTO customer_orders(order_id, customer_id, order_date, status)
                   VALUES (?, ?, ?, ?)""",
                [(int(row["id"]), str(row["customer_id"]), row["order_date"], row["status"])
                 for row in orders],
            )
            connection.executemany(
                """INSERT INTO order_items
                   (order_item_id, source_order_item_id, order_id, product_id, quantity,
                    unit_price_at_order, discount_per_unit)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                [(internal_id, int(row["id"]), int(row["order_id"]), product_ref[int(row["product_id"])],
                  int(row["quantity"]), None, 0)
                 for internal_id, row in enumerate(order_items, start=1)],
            )

            price_values = []
            for row in price_rows:
                if row["item_type"] == "Товар":
                    product_id, resource_id = product_ref[int(row["item_id"])], None
                else:
                    key = (int(row["item_id"]), row["item_type"])
                    resource_id = typed_resource_ref.get(key, resource_ref.get(int(row["item_id"])))
                    if resource_id is None:
                        raise ValueError(f"Для цены не найден ресурс: {key}")
                    product_id = None
                price_values.append((int(row["id"]), product_id, resource_id, float(row["price"])))
            connection.executemany(
                "INSERT INTO prices(price_id, product_id, resource_id, unit_price) VALUES (?, ?, ?, ?)",
                price_values,
            )

            discount_values = []
            for row in discount_rows:
                if row["item_type"] == "Товар":
                    product_id, resource_id = product_ref[int(row["item_id"])], None
                else:
                    key = (int(row["item_id"]), row["item_type"])
                    resource_id = typed_resource_ref.get(key, resource_ref.get(int(row["item_id"])))
                    if resource_id is None:
                        raise ValueError(f"Для скидки не найден ресурс: {key}")
                    product_id = None
                discount_values.append((len(discount_values) + 1, int(row["id"]), product_id, resource_id,
                                        float(row["discount_percent"])))
            connection.executemany(
                """INSERT INTO discounts
                   (discount_id, source_discount_id, product_id, resource_id, discount_percent)
                   VALUES (?, ?, ?, ?, ?)""",
                discount_values,
            )

        violations = list(connection.execute("PRAGMA foreign_key_check"))
        if violations:
            raise RuntimeError(f"Нарушены внешние ключи: {violations[:5]}")
    finally:
        connection.close()

    print(f"База создана: {db_path}")
    print("Загружено записей:")
    for table in ("customers", "products", "resources", "product_specification",
                  "customer_orders", "order_items", "prices", "discounts"):
        with sqlite3.connect(db_path) as check:
            count = check.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        print(f"  {table}: {count}")
    if missing_product_ids:
        print("Добавлены помеченные заглушки для отсутствующих product_id:",
              ", ".join(map(str, missing_product_ids)))
    if duplicate_product_ids:
        print("Повторные source_product_id (ссылки назначены первой записи):", duplicate_product_ids)
    if duplicate_resource_ids:
        print("Повторные source_resource_id (FK товара/ресурса сохранены):", duplicate_resource_ids)
    if duplicate_order_item_ids:
        print("Повторные source_order_item_id (строки сохранены с surrogate PK):", duplicate_order_item_ids)
    if duplicate_discount_ids:
        print("Повторные source_discount_id (строки сохранены с surrogate PK):", duplicate_discount_ids)
    print("Проверка PRAGMA foreign_key_check: ошибок нет.")


if __name__ == "__main__":
    main()
