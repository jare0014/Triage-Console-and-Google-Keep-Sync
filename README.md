# Google Keep Sync Ingestion Pipeline

An automated extraction, transformation, and loading (ETL) pipeline that syncs Google Keep notes and checklists directly into an Obsidian Markdown environment.

## ⚙️ Architecture

* **Extraction (Python):** Adapts the Keep-it-Markdown (KIM) engine and `gkeepapi` to fetch raw notes and media.
* **Stateless OAuth Refreshes:** Refreshed session tokens are printed to `stdout` under memory and intercepted by the parent JavaScript plugin. The parent writes the updated token to the hardware-backed OS keychain, ensuring active session keys are never written to plaintext JSON files on disk.
* **Post-Processing Sanitization:** Removes sync footers (timestamps, Keep URLs) and runs an automated naming sanitization to ensure links match Obsidian's strict wiki-link syntax.

## 🙏 Acknowledgments

* **Keep-it-Markdown (KIM)**: This extraction engine builds upon the original [keep-it-markdown](https://github.com/djseng/keep-it-markdown) python project created by `djseng`.
* **gkeepapi**: Utilizes the unofficial Google Keep API client by `kiwiz`.
