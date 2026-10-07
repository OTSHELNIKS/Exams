-- Задание 3. Полная себестоимость клиентского заказа.
-- Параметр :order_id — номер заказа из customer_orders.
-- В product_specification находятся нормы расхода и материалов, и операций;
-- prices содержит цену ресурса. Скидки и продажная цена товара в себестоимость
-- производства не входят.

WITH components AS (
    SELECT
        o.order_id,
        oi.order_item_id,
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
)
SELECT
    order_id,
    CASE
        WHEN COUNT(specification_id) = 0
          OR COUNT(price_id) <> COUNT(specification_id)
        THEN NULL
        ELSE ROUND(SUM(ordered_quantity * quantity_per_product * unit_price), 2)
    END AS total_manufacturing_cost,
    COUNT(specification_id) AS required_cost_positions,
    COUNT(price_id) AS priced_positions
FROM components
GROUP BY order_id;

-- Детализация того же расчёта: норма × цена × количество продукции в заказе.
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
