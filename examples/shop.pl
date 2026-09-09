app "Shop"

database Product:
    name: text
    price: money
    in_stock: boolean

page "Products":
    title "Our Products"
    show Product
    form "Add Product" from Product:
        field name: text
        field price: number
        field in_stock: boolean

page "About":
    title "About This Shop"
