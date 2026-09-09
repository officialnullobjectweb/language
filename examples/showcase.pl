# Milestone 7: First 7 days — everything together
set name = "Plainly"
set age = 23

if age >= 18:
    say "Hello " + name + ", you are an adult."
otherwise:
    say "Hello " + name + ", you are a minor."

function double(n):
    return n * 2

set numbers = [1, 2, 3, 4]
set doubled = []

for each n in numbers:
    set doubled = doubled + [double(n)]

say doubled
