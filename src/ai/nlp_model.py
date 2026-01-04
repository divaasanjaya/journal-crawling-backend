import pandas as pd
import numpy as np
import faiss
import json
import os
from pymongo import MongoClient
from sentence_transformers import SentenceTransformer
from bertopic import BERTopic
from keybert import KeyBERT

class JournalNLPModel:
    def __init__(self, mongo_uri=None):
        self.mongo_uri = mongo_uri or "mongodb://crawler:journal-crawler123@localhost:27017/journal_crawling?authSource=admin"
        self.model = None
        self.topic_model = None
        self.kw_model = None
        self.df = None
        self.embeddings = None
        self.index = None
        self.topic_keywords = None

    def load_data(self):
        """Load journal data from MongoDB"""
        try:
            client = MongoClient(self.mongo_uri)
            db = client.journal_crawling
            collection = db.journal

            # Fetch all journal documents
            journals = list(collection.aggregate([
                {
                    "$project": {
                        "id": { "$toString": "$_id" },
                        "title": 1,
                        "publicationYear": 1,
                        "publicationName": 1,
                        "citation": 1,
                        "authors": 1,
                        "text": 1,
                        "_id": 0
                    }
                }
            ]))

            # Convert to DataFrame
            self.df = pd.DataFrame(journals)
            self.df["text"] = self.df["title"].fillna("")
            self.df = self.df[
                [
                    "id",
                    "title",
                    "publicationYear",
                    "publicationName",
                    "citation",
                    "authors",
                    "text"
                ]
            ]

            print(f"Loaded {len(self.df)} journal entries")
            return True
        except Exception as e:
            print(f"Error loading data: {e}")
            return False

    def build_search_index(self):
        """Build FAISS index for semantic search"""
        if self.df is None:
            if not self.load_data():
                return False

        self.model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")

        self.embeddings = self.model.encode(
            self.df["text"].tolist(),
            show_progress_bar=True,
            convert_to_numpy=True
        )

        # Normalize for cosine similarity
        faiss.normalize_L2(self.embeddings)

        self.index = faiss.IndexFlatIP(self.embeddings.shape[1])
        self.index.add(self.embeddings)

        print(f"Built search index with {self.index.ntotal} documents")
        return True

    def build_topic_model(self):
        """Build BERTopic model for topic analysis"""
        if self.df is None:
            if not self.load_data():
                return False

        self.topic_model = BERTopic(
            language="multilingual",
            calculate_probabilities=True,
            verbose=True
        )

        topics, probs = self.topic_model.fit_transform(self.df["text"])
        self.df["topic_id"] = topics

        # Extract topic probabilities
        assigned_topic_probs = np.zeros(len(topics))
        for i, topic_id in enumerate(topics):
            if topic_id != -1:
                assigned_topic_probs[i] = probs[i, topic_id]
            else:
                assigned_topic_probs[i] = 0.0

        self.df["topic_prob"] = assigned_topic_probs

        # Extract keywords for topics
        self.kw_model = KeyBERT(self.model)
        self.topic_keywords = []

        for topic_id in self.df["topic_id"].unique():
            if topic_id == -1:
                continue

            docs = self.df[self.df["topic_id"] == topic_id]["text"].tolist()
            joined_docs = " ".join(docs)

            keywords = self.kw_model.extract_keywords(joined_docs, top_n=5)

            self.topic_keywords.append({
                "topic_id": int(topic_id),
                "keywords": [kw for kw, _ in keywords]
            })

        print(f"Built topic model with {len(self.topic_keywords)} topics")
        return True

    def get_top_topics(self, top_n=5):
        """Get top N topics by publication count"""
        if self.df is None or "topic_id" not in self.df.columns:
            return []

        topic_count = (
            self.df.groupby("topic_id")
            .size()
            .reset_index(name="count")
            .sort_values("count", ascending=False)
        )

        topic_labels = self.topic_model.get_topic_info()

        top_topics = []
        count = 0

        for _, row in topic_count.iterrows():
            if count >= top_n:
                break

            # Skip outlier topics (-1) only if we have other topics available
            if row["topic_id"] == -1 and len(topic_count) > top_n:
                continue

            # Get keywords (empty for outliers)
            keywords = []
            if row["topic_id"] != -1 and self.topic_keywords is not None:
                keywords = next((t["keywords"] for t in self.topic_keywords if t["topic_id"] == row["topic_id"]), [])

            # Get topic name
            if row["topic_id"] == -1:
                topic_name = "Miscellaneous/Outlier Topics"
            elif keywords:
                topic_name = keywords[0]  # Use the top keyword as topic name
            else:
                # Fallback to BERTopic's auto-generated topic name
                name_result = topic_labels.loc[
                    topic_labels["Topic"] == row["topic_id"],
                    "Name"
                ]
                if len(name_result) > 0:
                    name = name_result.values[0]
                    # Replace underscores with spaces and take first 2 words
                    words = name.replace("_", " ").split()
                    topic_name = " ".join(words[1:3])  # Skip the "topic_X" prefix
                else:
                    topic_name = f"Topic {row['topic_id']}"

            top_topics.append({
                "topic_id": int(row["topic_id"]),
                "topic_name": topic_name,
                "count": int(row["count"]),
                "keywords": keywords
            })

            count += 1

        return top_topics

    def semantic_search(self, query, top_k=20):
        """Perform semantic search on journal titles"""
        if self.model is None or self.index is None:
            if not self.build_search_index():
                return []

        # Query expansion (simple synonym expansion)
        SYNONYM_DICT = {
            "ai": ["artificial intelligence"],
            "machine learning": ["ml", "deep learning"],
            "computer vision": ["image processing", "visual recognition"],
            "iot": ["internet of things"],
            "data science": ["data analytics", "big data"]
        }

        expanded = [query]
        q_lower = query.lower()

        for key, synonyms in SYNONYM_DICT.items():
            if key in q_lower:
                expanded.extend(synonyms)

        expanded_query = " ".join(expanded)

        query_vec = self.model.encode([expanded_query], convert_to_numpy=True)
        faiss.normalize_L2(query_vec)

        scores, indices = self.index.search(query_vec, top_k)

        results = []
        for i, score in zip(indices[0], scores[0]):
            if i < len(self.df):
                results.append({
                    "id": self.df.iloc[i]["id"],
                    "title": self.df.iloc[i]["title"],
                    "year": int(self.df.iloc[i]["publicationYear"])
                            if pd.notna(self.df.iloc[i]["publicationYear"]) else None,
                    "publicationName": self.df.iloc[i]["publicationName"],
                    "citation": int(self.df.iloc[i]["citation"])
                                if pd.notna(self.df.iloc[i]["citation"]) else None,
                    "authors": self.df.iloc[i]["authors"],
                    "similarity_score": float(score)
                })

        return results

    def save_models(self, path="models/"):
        """Save trained models"""
        os.makedirs(path, exist_ok=True)

        if self.topic_model:
            self.topic_model.save(os.path.join(path, "bertopic_model"))
        if self.embeddings is not None:
            np.save(os.path.join(path, "embeddings.npy"), self.embeddings)
        if self.df is not None:
            self.df.to_pickle(os.path.join(path, "dataframe.pkl"))
        if self.topic_keywords is not None:
            with open(os.path.join(path, "topic_keywords.json"), "w") as f:
                json.dump(self.topic_keywords, f)
        if self.get_top_topics(5):
            with open(os.path.join(path, "top_topics.json"), "w") as f:
                json.dump(self.get_top_topics(5), f)

        print(f"Models saved to {path}")

    def load_models(self, path="models/"):
        """Load trained models"""
        try:
            if os.path.exists(os.path.join(path, "bertopic_model")):
                self.topic_model = BERTopic.load(os.path.join(path, "bertopic_model"))
            if os.path.exists(os.path.join(path, "embeddings.npy")):
                self.embeddings = np.load(os.path.join(path, "embeddings.npy"))
                self.model = SentenceTransformer("sentence-transformers/all-MiniLM-L6-v2")
                faiss.normalize_L2(self.embeddings)
                self.index = faiss.IndexFlatIP(self.embeddings.shape[1])
                self.index.add(self.embeddings)
            if os.path.exists(os.path.join(path, "dataframe.pkl")):
                self.df = pd.read_pickle(os.path.join(path, "dataframe.pkl"))
            if os.path.exists(os.path.join(path, "topic_keywords.json")):
                with open(os.path.join(path, "topic_keywords.json"), "r") as f:
                    self.topic_keywords = json.load(f)

            print(f"Models loaded from {path}")
            return True
        except Exception as e:
            print(f"Error loading models: {e}")
            return False

if __name__ == "__main__":
    # Initialize and train the model
    nlp_model = JournalNLPModel()

    print("Loading data...")
    nlp_model.load_data()

    print("Building search index...")
    nlp_model.build_search_index()

    print("Building topic model...")
    nlp_model.build_topic_model()

    print("Saving models...")
    nlp_model.save_models()

    # Test the model
    print("\nTop 5 topics:")
    top_topics = nlp_model.get_top_topics(5)
    for topic in top_topics:
        print(f"- {topic['topic_name']}: {topic['count']} publications")

    print("\nSearch test:")
    results = nlp_model.semantic_search("artificial intelligence", 5)
    for result in results:
        print(f"- {result['title']} (score: {result['similarity_score']:.3f})")
