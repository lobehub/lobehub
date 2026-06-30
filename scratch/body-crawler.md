### 🛠️ Problem
Large HTML pages parsed via JSDOM and `@mozilla/readability` were failing because they were nested inside `document.body.innerHTML`, producing malformed DOM trees where `<html>` and `<head>` tags were parsed as body content. This prevented Readability from extracting metadata and article content, causing web crawler requests to return empty/too-short markdown for large modern pages.

### ⚙️ Solution
Use `document.write(html)` instead of `document.body.innerHTML = html` on the happy-dom document, which properly parses complete HTML document hierarchies (retaining meta tags, html attributes like lang, etc.). Update snapshot tests to reflect the improved metadata extraction.

Fixes #15180
