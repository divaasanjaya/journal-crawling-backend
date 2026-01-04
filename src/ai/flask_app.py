from flask import Flask, request, jsonify
import sys
import os
sys.path.append(os.path.dirname(__file__))

from nlp_model import JournalNLPModel

app = Flask(__name__)

# Global model instance
nlp_model = None

def load_model():
    global nlp_model
    if nlp_model is None:
        nlp_model = JournalNLPModel()
        if not nlp_model.load_models():
            raise Exception("Failed to load models. Please train the model first.")
    return nlp_model

@app.route('/search', methods=['GET'])
def search():
    query = request.args.get('q')
    top_k = request.args.get('top_k', 20, type=int)

    if not query:
        return jsonify({"error": "Query parameter 'q' is required"}), 400

    try:
        model = load_model()
        results = model.semantic_search(query, top_k)
        return jsonify(results)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    load_model()  # Load model on startup
    app.run(host='0.0.0.0', port=5000, debug=False)
