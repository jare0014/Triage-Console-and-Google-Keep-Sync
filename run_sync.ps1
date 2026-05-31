# 1. Set Location using the universal User Profile variable
# This avoids the 'C:\Users\aljar' hardcoded path
Set-Location "$env:USERPROFILE\Documents\Obsidian\.obsidian\plugins\google-keep-sync"

# 2. Run the script using the LOCAL virtual environment
# This removes the dependency on a global Python 3.13 install
& ".\venv\Scripts\python.exe" kim.py -b "--all" -m