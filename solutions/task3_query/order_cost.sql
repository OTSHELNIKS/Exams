-- Задание 3. Полная себестоимость клиентского заказа.
-- Параметр :order_id — номер заказа из customer_orders.
-- В product_specification находятся нормы расхода и материалов, и операций;
-- prices содержит цену ресурса. Скидки и продажная цена товара в себестоимость
-- производства не входят.
-- Если у любой строки заказа нет BOM или у любого ресурса нет цены,
-- итог не подменяется частичной суммой: total_manufacturing_cost будет NULL.

WITH components AS (
    SELECT
        o.order_id,
        oi.order_item_id,
        oi.product_id,
        oi.quantity AS ordered_quantity,
        ps.specification_id,
        ps.quantity_per_product,
        r.resource_id,
        p.price_id,
        p.unit_price
    FROM customer_orders AS o
    JOIN order_items AS oi
      ON oi.order_id = o.order_id
    LEFT JOIN product_specification AS ps
      ON ps.product_id = oi.product_id
    LEFT JOIN resources AS r
      ON r.resource_id = ps.resource_id
    LEFT JOIN prices AS p
      ON p.resource_id = r.resource_id
     AND p.product_id IS NULL
    WHERE o.order_id = :order_id
),
coverage AS (
    SELECT
        order_id,
        COUNT(DISTINCT order_item_id) AS order_positions,
        COUNT(DISTINCT CASE WHEN specification_id IS NOT NULL THEN order_item_id END)
            AS positions_with_bom,
        COUNT(specification_id) AS required_cost_positions,
        COUNT(price_id) AS priced_positions,
        SUM(ordered_quantity * quantity_per_product * unit_price) AS raw_total
    FROM components
    GROUP BY order_id
)
SELECT
    order_id,
    CASE
        WHEN positions_with_bom <> order_positions
          OR required_cost_positions = 0
          OR priced_positions <> required_cost_positions
        THEN NULL
        ELSE ROUND(raw_total, 2)
    END AS total_manufacturing_cost,
    required_cost_positions,
    priced_positions
FROM coverage;

-- Детализация того же расчёта: норма × цена × количество продукции.
SELECT
    o.order_id,
    oi.order_item_id,
    p.name AS product_name,
    oi.quantity AS ordered_quantity,
    r.name AS resource_name,
    r.resource_type,
    ps.quantity_per_product,
    pr.unit_price,
    ROUND(ps.quantity_per_product * oi.quantity * pr.unit_price, 2) AS component_total
FROM customer_orders AS o
JOIN order_items AS oi
  ON oi.order_id = o.order_id
JOIN products AS p
  ON p.product_id = oi.product_id
JOIN product_specification AS ps
  ON ps.product_id = oi.product_id
JOIN resources AS r
  ON r.resource_id = ps.resource_id
JOIN prices AS pr
  ON pr.resource_id = r.resource_id
 AND pr.product_id IS NULL
WHERE o.order_id = :order_id
ORDER BY oi.order_item_id, r.resource_type, r.name;
