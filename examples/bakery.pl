app "Golden Crumb"

database Product:
    name: text
    description: text
    price: money
    in_stock: boolean

database Order:
    customer_name: text
    customer_email: email
    pickup_day: date
    notes: text

page "Home":
    title "Fresh every morning"
    button "See today's menu":
        say "Menu opened"

page "Menu":
    title "Our bakes"
    show Product
    form "Add a bake" from Product:
        field name: text
        field description: text
        field price: number
        field in_stock: boolean

page "Order":
    title "Pre-order your box"
    show Order
    form "Place an order" from Order:
        field customer_name: text
        field customer_email: email
        field pickup_day: date
        field notes: text

page "Visit":
    title "Find us"
    state visitors = 0
    button "Say hello":
        set visitors = visitors + 1
        say visitors
