PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS customers (
    customer_id TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    inn         TEXT NOT NULL DEFAULT '',
    address     TEXT NOT NULL DEFAULT '',
    phone       TEXT NOT NULL DEFAULT '',
    party_type  TEXT NOT NULL CHECK (party_type IN ('Покупатель', 'Поставщик', 'Прочее'))
);

CREATE TABLE IF NOT EXISTS products (
    product_id        INTEGER PRIMARY KEY,
    source_product_id INTEGER NOT NULL,
    name              TEXT NOT NULL,
    category          TEXT NOT NULL DEFAULT '',
    is_placeholder    INTEGER NOT NULL DEFAULT 0 CHECK (is_placeholder IN (0, 1))
);
CREATE INDEX IF NOT EXISTS idx_products_source_id ON products(source_product_id);

CREATE TABLE IF NOT EXISTS resources (
    resource_id        INTEGER PRIMARY KEY,
    source_resource_id INTEGER NOT NULL,
    name               TEXT NOT NULL,
    resource_type      TEXT NOT NULL CHECK (resource_type IN ('Материал', 'Операция'))
);
CREATE INDEX IF NOT EXISTS idx_resources_source_id ON resources(source_resource_id);

CREATE TABLE IF NOT EXISTS product_specification (
    specification_id    INTEGER PRIMARY KEY,
    product_id          INTEGER NOT NULL REFERENCES products(product_id),
    resource_id         INTEGER NOT NULL REFERENCES resources(resource_id),
    quantity_per_product NUMERIC NOT NULL CHECK (quantity_per_product > 0),
    UNIQUE (product_id, resource_id)
);

CREATE TABLE IF NOT EXISTS customer_orders (
    order_id    INTEGER PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(customer_id),
    order_date  TEXT NOT NULL,
    status      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS order_items (
    order_item_id        INTEGER PRIMARY KEY,
    source_order_item_id INTEGER NOT NULL,
    order_id             INTEGER NOT NULL REFERENCES customer_orders(order_id) ON DELETE CASCADE,
    product_id           INTEGER NOT NULL REFERENCES products(product_id),
    quantity             INTEGER NOT NULL CHECK (quantity > 0),
    unit_price_at_order  NUMERIC CHECK (unit_price_at_order IS NULL OR unit_price_at_order >= 0),
    discount_per_unit    NUMERIC NOT NULL DEFAULT 0 CHECK (discount_per_unit >= 0),
    CHECK (unit_price_at_order IS NULL OR discount_per_unit <= unit_price_at_order)
);

CREATE TABLE IF NOT EXISTS production_orders (
    production_order_id INTEGER PRIMARY KEY,
    order_number        TEXT NOT NULL,
    launch_date         TEXT NOT NULL,
    department          TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS production_order_items (
    production_order_item_id INTEGER PRIMARY KEY,
    production_order_id      INTEGER NOT NULL REFERENCES production_orders(production_order_id) ON DELETE CASCADE,
    product_id               INTEGER NOT NULL REFERENCES products(product_id),
    quantity                 NUMERIC NOT NULL CHECK (quantity > 0),
    unit                     TEXT NOT NULL DEFAULT 'шт'
);

CREATE TABLE IF NOT EXISTS prices (
    price_id   INTEGER PRIMARY KEY,
    product_id INTEGER REFERENCES products(product_id),
    resource_id INTEGER REFERENCES resources(resource_id),
    unit_price NUMERIC NOT NULL CHECK (unit_price >= 0),
    CHECK (
        (product_id IS NOT NULL AND resource_id IS NULL) OR
        (product_id IS NULL AND resource_id IS NOT NULL)
    )
);

CREATE TABLE IF NOT EXISTS discounts (
    discount_id       INTEGER PRIMARY KEY,
    source_discount_id INTEGER NOT NULL,
    product_id        INTEGER REFERENCES products(product_id),
    resource_id       INTEGER REFERENCES resources(resource_id),
    discount_percent  NUMERIC NOT NULL CHECK (discount_percent BETWEEN 0 AND 100),
    CHECK (
        (product_id IS NOT NULL AND resource_id IS NULL) OR
        (product_id IS NULL AND resource_id IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS idx_orders_customer ON customer_orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id);
CREATE INDEX IF NOT EXISTS idx_spec_product ON product_specification(product_id);
CREATE INDEX IF NOT EXISTS idx_spec_resource ON product_specification(resource_id);
CREATE INDEX IF NOT EXISTS idx_prices_resource ON prices(resource_id);
CREATE INDEX IF NOT EXISTS idx_prices_product ON prices(product_id);
