# custom-keep-sync
Customized googlekeepAPI script for personal workflow, converting Google Keep notes into markdown files in Obsidian vault, allowing for more robust management of the variety and scope of content. 
Includes a specialized "Quicklog" list for individual entries to get automatically appended to "daily note" in Obsidian vault.

## Overview
KeepSync is a local data ingestion pipeline that automates the extraction, transformation, and loading of unstructured notes from Google Keep into a local, relationship-driven markdown environment (Obsidian).

Designed with environment isolation in mind, it utilizes a local virtual environment and PowerShell automation to run entirely independently of global system configurations, allowing for seamless execution across multiple Windows machines.

## Acknowledgments & Attribution
This pipeline is built upon the foundational work of the open-source community:

The core extraction script (kim.py) and token generation logic (get_token.py) are heavily adapted from the Keep-it-Markdown (KIM v0.6.8) project.

API interaction is handled via the unofficial gkeepapi Python library.

My modifications focus on decoupling these tools from plugin architectures, wrapping them in a local virtual environment, and adding post-processing scripts to create a machine-agnostic, automated batch job.

## System Architecture
The pipeline consists of four distinct stages:

Authentication (get_token.py): Exchanges a temporary Google OAuth browser cookie for a persistent Master Token, bypassing standard API restrictions.

Extraction & Transformation (kim.py & settings.cfg): Connects to the Keep API, downloads notes/media, and translates the proprietary Keep format into standard Markdown with YAML frontmatter. Relative pathing routes the output directly to the vault's 00_Imports directory.

Post-Processing (File namer.py): Scans the ingested .md files and cleans up filenames based on their internal frontmatter and content to ensure compatibility with Obsidian's linking syntax.

Execution (run_sync.ps1): A PowerShell wrapper that establishes the local machine's $env:USERPROFILE path and executes the pipeline using the isolated venv Python executable, preventing global dependency conflicts.

## Installation & Setup
### 1. Environment Preparation
Clone the repository into your Obsidian Vault's system/scripts directory (e.g., 99_System\GoogleKeepSync).

```
python -m venv venv
.\venv\Scripts\activate
pip install -r requirements.txt
```

### 2. Configuration
Edit the settings.cfg (or settings.ini) file to match your environment. By default, the pipeline uses relative pathing to locate the import folders:

```
[SETTINGS]
google_userid = your.email@gmail.com
output_path = ../../00_Imports
media_path = media
```
### 3. Authentication (OAuth Cookie Workaround)
Open an Incognito/Private browsing window and log into Google Keep.

Open Developer Tools (F12) -> Application/Storage -> Cookies.

Locate the cookie named oauth_token (or aas_et) for accounts.google.com and copy its Value.

Run the token generator using your isolated environment:

```
.\venv\Scripts\python.exe get_token.py
Follow the prompts to input your email and the copied cookie. The script will save the Master Token to your local keyring.
```

## Execution
To run the complete ingestion pipeline, simply execute the PowerShell script. This can be run manually or scheduled as a background Windows Task.

```PowerShell
.\run_sync.ps1
```
