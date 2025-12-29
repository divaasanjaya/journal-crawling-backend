# Add this to your environment if not present:
# pip install pymongo

import os
from pymongo import MongoClient

# You can adjust this connection string as needed
MONGO_URI = os.environ.get("MONGO_URI", "mongodb://localhost:27017/")
MONGO_DB = os.environ.get("MONGO_DB", "journal_crawling")
MONGO_COLLECTION = os.environ.get("MONGO_COLLECTION", "scholar_articles")

client = MongoClient(MONGO_URI)
db = client[MONGO_DB]
collection = db[MONGO_COLLECTION]

def insert_articles(articles):
    if articles:
        if isinstance(articles, dict):
            articles = [articles]
        upserted = 0
        for art in articles:
            # Use DOI or EID if available, else fallback to title+authors as unique key
            query = {}
            if art.get('doi'):
                query['doi'] = art['doi']
            elif art.get('eid'):
                query['eid'] = art['eid']
            else:
                # Fallback: use title+authors as unique key
                query['title'] = art.get('title')
                query['authors'] = art.get('authors')
            result = collection.update_one(query, {'$set': art}, upsert=True)
            if result.upserted_id or result.modified_count:
                upserted += 1
        print(f"Upserted {upserted} articles to MongoDB.")
    else:
        print("No articles to insert.")
