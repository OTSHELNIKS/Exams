#!/usr/bin/env python3
"""Генератор PDF ER-диаграммы (нужен reportlab)."""
from pathlib import Path
from math import hypot

from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import landscape, A3
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

HERE = Path(__file__).resolve().parent
OUTPUT = HERE / "ER_диаграмма.pdf"
FONT = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
FONT_BOLD = Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
pdfmetrics.registerFont(TTFont("DejaVu", str(FONT)))
pdfmetrics.registerFont(TTFont("DejaVu-Bold", str(FONT_BOLD)))

PAGE_W, PAGE_H = landscape(A3)
NAVY = HexColor("#172B4D")
BLUE = HexColor("#4058D6")
MINT = HexColor("#DDF4EE")
PALE = HexColor("#F2F5FB")
MUTED = HexColor("#52627A")
EDGE = HexColor("#58708E")

entities = [
    {"key":"customers", "ru":"Заказчики", "row":0, "col":0,
     "fields":[("PK", "customer_id TEXT"), ("", "name"), ("", "inn"), ("", "address"), ("", "phone"), ("", "party_type")]},
    {"key":"customer_orders", "ru":"Заказы покупателей", "row":0, "col":1,
     "fields":[("PK", "order_id"), ("FK", "customer_id"), ("", "order_date"), ("", "status")]},
    {"key":"order_items", "ru":"Позиции заказа", "row":0, "col":2,
     "fields":[("PK", "order_item_id"), ("", "source_order_item_id"), ("FK", "order_id"), ("FK", "product_id"), ("", "quantity > 0"), ("", "unit_price_at_order, discount_per_unit")]},
    {"key":"products", "ru":"Товары", "row":0, "col":3,
     "fields":[("PK", "product_id"), ("", "source_product_id"), ("", "name"), ("", "category"), ("", "is_placeholder")]},
    {"key":"resources", "ru":"Материалы и операции", "row":0, "col":4,
     "fields":[("PK", "resource_id"), ("", "source_resource_id"), ("", "name"), ("", "resource_type")]},
    {"key":"production_orders", "ru":"Заказы на производство", "row":1, "col":0,
     "fields":[("PK", "production_order_id"), ("", "order_number"), ("", "launch_date"), ("", "department")]},
    {"key":"production_order_items", "ru":"Выпускаемая продукция", "row":1, "col":1,
     "fields":[("PK", "production_order_item_id"), ("FK", "production_order_id"), ("FK", "product_id"), ("", "quantity, unit")]},
    {"key":"product_specification", "ru":"Спецификация / BOM", "row":1, "col":2,
     "fields":[("PK", "specification_id"), ("FK", "product_id"), ("FK", "resource_id"), ("", "quantity_per_product")]},
    {"key":"prices", "ru":"Цены", "row":1, "col":3,
     "fields":[("PK", "price_id"), ("FK*", "product_id NULL"), ("FK*", "resource_id NULL"), ("", "unit_price >= 0")]},
    {"key":"discounts", "ru":"Скидки", "row":1, "col":4,
     "fields":[("PK", "discount_id"), ("", "source_discount_id"), ("FK*", "product_id NULL"), ("FK*", "resource_id NULL"), ("", "discount_percent")]},
]

MARGIN_X = 26
GAP_X = 12
CARD_W = (PAGE_W - 2*MARGIN_X - 4*GAP_X) / 5
CARD_H = 160
ROW_Y = {0: 590, 1: 333}


def wrap_text(text: str, font_name: str, size: float, max_width: float) -> list[str]:
    words = text.split()
    lines, current = [], ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if current and pdfmetrics.stringWidth(candidate, font_name, size) > max_width:
            lines.append(current)
            current = word
        else:
            current = candidate
    if current:
        lines.append(current)
    return lines


def draw_card(c: canvas.Canvas, entity: dict) -> dict:
    x = MARGIN_X + entity["col"] * (CARD_W + GAP_X)
    y = ROW_Y[entity["row"]]
    c.setFillColor(white)
    c.setStrokeColor(HexColor("#C9D3E2"))
    c.setLineWidth(1.0)
    c.roundRect(x, y, CARD_W, CARD_H, 9, fill=1, stroke=1)
    c.setFillColor(NAVY if entity["row"] == 0 else HexColor("#234E63"))
    c.roundRect(x, y + CARD_H - 35, CARD_W, 35, 9, fill=1, stroke=0)
    c.rect(x, y + CARD_H - 35, CARD_W, 9, fill=1, stroke=0)
    c.setFillColor(white)
    c.setFont("DejaVu-Bold", 9.5)
    c.drawString(x + 9, y + CARD_H - 15, entity["key"])
    c.setFont("DejaVu", 7.5)
    c.drawString(x + 9, y + CARD_H - 28, entity["ru"])
    line_y = y + CARD_H - 49
    for tag, value in entity["fields"]:
        prefix = (tag + "  ") if tag else ""
        color = BLUE if tag.startswith("PK") else (HexColor("#17735F") if tag.startswith("FK") else NAVY)
        c.setFillColor(color)
        c.setFont("DejaVu-Bold" if tag else "DejaVu", 7.8)
        for line in wrap_text(prefix + value, "DejaVu-Bold" if tag else "DejaVu", 7.8, CARD_W - 17):
            c.drawString(x + 9, line_y, line)
            line_y -= 11.7
    return {"x":x, "y":y, "w":CARD_W, "h":CARD_H, "cx":x+CARD_W/2, "cy":y+CARD_H/2}


def connect(c: canvas.Canvas, start: tuple[float,float], end: tuple[float,float], label: str,
            dashed: bool=False, label_offset: tuple[float,float]=(0,6)) -> None:
    x1,y1=start; x2,y2=end
    c.saveState()
    c.setStrokeColor(EDGE)
    c.setFillColor(EDGE)
    c.setLineWidth(1.1)
    if dashed:
        c.setDash(3, 2)
    c.line(x1,y1,x2,y2)
    length = hypot(x2-x1,y2-y1) or 1
    ux,uy=(x2-x1)/length,(y2-y1)/length
    size=5
    bx,by=x2-ux*size,y2-uy*size
    px,py=-uy*size*.55,ux*size*.55
    path=c.beginPath(); path.moveTo(x2,y2); path.lineTo(bx+px,by+py); path.lineTo(bx-px,by-py); path.close()
    c.drawPath(path,fill=1,stroke=0)
    c.setDash()
    mx,my=(x1+x2)/2+label_offset[0],(y1+y2)/2+label_offset[1]
    text_w=pdfmetrics.stringWidth(label,"DejaVu-Bold",7.1)
    c.setFillColor(white)
    c.roundRect(mx-text_w/2-3,my-2,text_w+6,11,3,fill=1,stroke=0)
    c.setFillColor(BLUE)
    c.setFont("DejaVu-Bold",7.1)
    c.drawCentredString(mx,my,label)
    c.restoreState()


def main() -> None:
    c = canvas.Canvas(str(OUTPUT), pagesize=(PAGE_W,PAGE_H))
    c.setTitle("ER-диаграмма — экзамен 09.02.07")
    c.setAuthor("Экзаменационные материалы")
    c.setFillColor(NAVY); c.setFont("DejaVu-Bold",18)
    c.drawString(26,PAGE_H-31,"Задание 1. ER-диаграмма информационной системы производства")
    c.setFillColor(MUTED); c.setFont("DejaVu",9)
    c.drawString(26,PAGE_H-49,"Логическая модель в третьей нормальной форме; PK — первичный ключ, FK — внешний ключ, FK* — один из двух взаимоисключающих FK.")

    boxes={entity["key"]:draw_card(c,entity) for entity in entities}
    b=boxes
    # Основной контур клиентского заказа.
    connect(c,(b["customers"]["x"]+b["customers"]["w"],b["customers"]["cy"]+18),(b["customer_orders"]["x"],b["customer_orders"]["cy"]+18),"1 : N")
    connect(c,(b["customer_orders"]["x"]+b["customer_orders"]["w"],b["customer_orders"]["cy"]+18),(b["order_items"]["x"],b["order_items"]["cy"]+18),"1 : N")
    connect(c,(b["products"]["x"],b["products"]["cy"]-18),(b["order_items"]["x"]+b["order_items"]["w"],b["order_items"]["cy"]-18),"1 : N",label_offset=(0,-11))
    # Состав изделия: связь M:N через таблицу спецификации.
    connect(c,(b["products"]["cx"],b["products"]["y"]),(b["product_specification"]["x"]+b["product_specification"]["w"],b["product_specification"]["y"]+b["product_specification"]["h"]),"1 : N")
    connect(c,(b["resources"]["cx"],b["resources"]["y"]),(b["product_specification"]["x"]+b["product_specification"]["w"]-24,b["product_specification"]["y"]+b["product_specification"]["h"]),"1 : N",label_offset=(0,-10))
    # Цены и скидки опционально относятся либо к товару, либо к ресурсу.
    connect(c,(b["products"]["cx"],b["products"]["y"]),(b["prices"]["cx"],b["prices"]["y"]+b["prices"]["h"]),"1 : 0..N",True)
    connect(c,(b["resources"]["x"]+b["resources"]["w"]-22,b["resources"]["y"]),(b["prices"]["x"]+b["prices"]["w"],b["prices"]["y"]+b["prices"]["h"]-25),"1 : 0..N",True,(4,-6))
    connect(c,(b["products"]["x"]+b["products"]["w"],b["products"]["y"]+20),(b["discounts"]["x"],b["discounts"]["y"]+b["discounts"]["h"]-20),"1 : 0..N",True,(0,9))
    connect(c,(b["resources"]["cx"],b["resources"]["y"]),(b["discounts"]["cx"],b["discounts"]["y"]+b["discounts"]["h"]),"1 : 0..N",True,(0,-9))
    # Производственный заказ.
    connect(c,(b["production_orders"]["x"]+b["production_orders"]["w"],b["production_orders"]["cy"]),(b["production_order_items"]["x"],b["production_order_items"]["cy"]),"1 : N")
    connect(c,(b["products"]["x"],b["products"]["y"]+25),(b["production_order_items"]["x"]+b["production_order_items"]["w"],b["production_order_items"]["y"]+b["production_order_items"]["h"]),"1 : N",label_offset=(0,-10))

    # Легенда и правила ссылочной целостности.
    note_y=282
    c.setFillColor(NAVY); c.setFont("DejaVu-Bold",10)
    c.drawString(26,note_y,"Связи и ограничения")
    c.setFillColor(MUTED); c.setFont("DejaVu",8.2)
    left_notes=[
        "Заказчик 1:N заказов; заказ 1:N позиций; товар 1:N позиций.",
        "Товар M:N ресурс через product_specification; количество — норма на единицу продукции.",
        "Производственный заказ 1:N строк выпуска; строка указывает товар, количество и единицу измерения.",
    ]
    right_notes=[
        "resource_type различает «Материал» и «Операция»; обе сущности тарифицируются одинаково.",
        "В prices и discounts ровно один FK: product_id ИЛИ resource_id (CHECK в schema.sql).",
        "Surrogate PK сохраняют строки с повторными исходными ID; пропущенные товары помечены is_placeholder=1.",
    ]
    for i,text in enumerate(left_notes):
        c.drawString(26,note_y-16-i*15,"• " + text)
    for i,text in enumerate(right_notes):
        c.drawString(PAGE_W/2+4,note_y-16-i*15,"• " + text)
    c.setFillColor(HexColor("#7A879A")); c.setFont("DejaVu",7)
    c.drawString(26,27,"Файлы реализации: schema.sql и seed.py. Модель не хранит вычисляемую себестоимость — она считается запросом по нормам спецификации и ценам ресурсов.")
    c.showPage(); c.save()
    print(OUTPUT)


if __name__ == "__main__":
    main()
