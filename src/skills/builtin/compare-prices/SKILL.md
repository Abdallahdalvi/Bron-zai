# Compare Prices

## Description
Search for a product across multiple retailers, extract prices, and produce a compact deal summary.

## Trigger Phrases
- compare prices for [product]
- find the best deal on [product]
- check prices across stores

## Required Tools
- new_page
- navigate_page
- get_page_content
- group_tabs
- filesystem_write

## Workflow
1. Open retailer tabs in background.
2. Search for the product on each page.
3. Capture name, price, and listing URL.
4. Save result as a table in markdown or HTML.
5. Report best value and lowest price.
