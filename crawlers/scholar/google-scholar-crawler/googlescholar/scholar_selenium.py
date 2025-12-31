
import time
import json
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.keys import Keys
from selenium.common.exceptions import WebDriverException
# MongoDB helper
from pymongo import MongoClient


# --- CONFIG & CLI ARGS ---
import argparse
parser = argparse.ArgumentParser()
parser.add_argument('--query', type=str, default='Telkom University', help='Search query')
parser.add_argument('--count', type=int, default=10, help='Number of results to fetch')
parser.add_argument('--output', type=str, default='output_selenium.json', help='Output JSON file')
parser.add_argument('--mongoUri', type=str, default=None, help='MongoDB URI (optional)')
args = parser.parse_args()

QUERY = args.query
RESULTS_LIMIT = args.count
OUTPUT_FILE = args.output

# Optionally override Mongo URI for automation
import os
if args.mongoUri:
    os.environ['MONGO_URI'] = args.mongoUri

# --- SETUP SELENIUM ---
chrome_options = Options()
chrome_options.add_argument('--headless')
chrome_options.add_argument('--disable-gpu')
chrome_options.add_argument('--no-sandbox')
chrome_options.add_argument('--window-size=1280,800')
chrome_options.add_argument('--lang=en-US')
chrome_options.add_argument('--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')


# Path to chromedriver (update if needed)
driver = webdriver.Chrome(options=chrome_options)

# DB
MONGO_URI = 'mongodb://localhost:27017/'  # Ganti jika perlu
DB_NAME = 'journal_crawling'  # Ganti jika perlu
COLLECTION_NAME = 'journal'

client = MongoClient(MONGO_URI)
db = client[DB_NAME]
col_journals = db[COLLECTION_NAME]

def insert_articles(journal):
        # Cek duplikasi berdasarkan title, doi, dan authors
        query = {
            "title": journal["title"],
            "doi": journal.get("doi", ""),
            "authors": journal.get("authors", [])
        }
        existing = col_journals.find_one(query)
        if not existing:
            col_journals.insert_one(journal)
        else:
            print(f"SKIP REDUNDAN: {journal['title']}")

# --- CRAWL ---
url = f"https://scholar.google.com/scholar?hl=en&q={QUERY.replace(' ', '+')}"
driver.get(url)
time.sleep(3)

# CAPTCHA detection helper
def is_captcha_page(driver):
    try:
        # Look for typical CAPTCHA text
        body_text = driver.page_source.lower()
        if 'please show you\'re not a robot' in body_text or 'recaptcha' in body_text:
            return True
        # Google sometimes uses other phrases, add more if needed
        return False
    except WebDriverException:
        return False

results = []

if is_captcha_page(driver):
    print("[!] CAPTCHA detected. Saving page for debugging.")
    with open("response_debug.html", "w", encoding="utf-8") as f:
        f.write(driver.page_source)
    driver.quit()
    # Save empty output for consistency
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=2)
    print(f"Saved 0 results to {OUTPUT_FILE}")
    print("CAPTCHA page saved as response_debug.html. Please solve CAPTCHA manually or try again later.")
    exit(1)

while len(results) < RESULTS_LIMIT:
    articles = driver.find_elements(By.CSS_SELECTOR, '.gs_r.gs_or')
    for art in articles:
        try:
            title_el = art.find_element(By.CSS_SELECTOR, '.gs_rt')
            title = title_el.text
            url = title_el.find_element(By.TAG_NAME, 'a').get_attribute('href') if title_el.find_elements(By.TAG_NAME, 'a') else None
            authors_info = art.find_element(By.CSS_SELECTOR, '.gs_a').text
            snippet = art.find_element(By.CSS_SELECTOR, '.gs_rs').text if art.find_elements(By.CSS_SELECTOR, '.gs_rs') else ''
            cited = 0
            cited_links = art.find_elements(By.PARTIAL_LINK_TEXT, 'Cited by')
            if cited_links:
                try:
                    cited = int(cited_links[0].text.split('Cited by ')[-1])
                except Exception:
                    cited = 0
            # Parse year (best effort)
            pub_year = None
            import re
            m = re.search(r'(\d{4})', authors_info)
            if m:
                pub_year = m.group(1)

            # Parse authors and affiliations (best effort)
            # Example authors_info: "Ramadan W., Sari D. - 2026 - Multidisciplinary Science Journal"
            authors_raw = authors_info.split('-')[0].strip()
            authors_list = [a.strip() for a in authors_raw.split(',') if a.strip()]
            # Dummy detailed authors (since Scholar doesn't provide)
            authors_detailed = []
            for a in authors_list:
                authors_detailed.append({
                    "name": a,
                    "authid": "",
                    "hIndex": 0,
                    "fullName": a
                })
            # Dummy affiliations (not available from Scholar)
            affiliations = []
            # Try to parse publication name
            pub_name = None
            if '-' in authors_info:
                parts = authors_info.split('-')
                if len(parts) > 2:
                    pub_name = parts[-1].strip()
            # Compose result in Scopus-like format
            journal = {
                'title': title,
                'publicationName': pub_name,
                'publicationYear': pub_year,
                'authors': authors_list,
                'authorsDetailed': authors_detailed,
                'affiliations': affiliations,
                'snippet': snippet,
                'citation': cited,
                'url': url,
                # Add more fields as needed, set to None or best-effort
                'doi': None,
                'eid': None
            }
            results.append(journal)
            insert_articles(journal)
            if len(results) >= RESULTS_LIMIT:
                break
        except Exception as e:
            continue
    # Next page if needed
    if len(results) < RESULTS_LIMIT:
        next_btn = driver.find_elements(By.LINK_TEXT, 'Next')
        if next_btn:
            next_btn[0].click()
            time.sleep(2)
            # Check for CAPTCHA after clicking next
            if is_captcha_page(driver):
                print("[!] CAPTCHA detected on next page. Saving page for debugging.")
                with open("response_debug.html", "w", encoding="utf-8") as f:
                    f.write(driver.page_source)
                driver.quit()
                with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
                    json.dump(results, f, ensure_ascii=False, indent=2)
                print(f"Saved {len(results)} results to {OUTPUT_FILE}")
                print("CAPTCHA page saved as response_debug.html. Please solve CAPTCHA manually or try again later.")
                exit(1)
        else:
            break

driver.quit()


# --- SAVE OUTPUT ---
with open(OUTPUT_FILE, 'w', encoding='utf-8') as f:
    json.dump(results, f, ensure_ascii=False, indent=2)
print(f"Saved {len(results)} results to {OUTPUT_FILE}")

