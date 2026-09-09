say "hello, world!"
app "My Bakery"

database Cake:
    name: text
    price: money

page "Menu":
    title "Our cakes"
    show Cake
    form "Add a cake" from Cake:
        field name: text
        field price: number

page "About":
    title "We love cake"