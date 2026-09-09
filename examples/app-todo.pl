app "Todo"

database Todo:
    title: text
    completed: boolean

page "Home":
    title "My Todos"
    show Todo
    button "Add Todo":
        create Todo
