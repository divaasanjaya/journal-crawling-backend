#!/usr/bin/env python3
import sys
import os
import json
import io
import contextlib
sys.path.append(os.path.dirname(__file__))

from nlp_model import JournalNLPModel

def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Query parameter required"}), file=sys.stderr)
        sys.exit(1)

    query = sys.argv[1]
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 20

    try:
        nlp_model = JournalNLPModel()

        # Suppress all output except final JSON
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            # Try to load saved models first
            if not nlp_model.load_models():
                print(json.dumps({"error": "Models not found. Please train the model first."}), file=sys.stderr)
                sys.exit(1)

            # Perform semantic search
            results = nlp_model.semantic_search(query, limit)

        # Output as JSON to stdout
        print(json.dumps(results, indent=2))

    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()
