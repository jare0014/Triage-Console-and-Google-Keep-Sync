const obsidian = require('obsidian');

const DEFAULT_SETTINGS = {
    googleUserid: '',
    googleKeepTokenId: 'google-keep-master-token',
    outputPath: '00_Imports',
    excludeTitles: 'Shopping, Wishlist',
    quicklogTitle: 'Quicklog',
    logHeader: '## 🪵 Log',
    syncOnStartup: true,
    enableIntervalSync: true,
    intervalSyncMinutes: 360
};

class GoogleKeepSyncPlugin extends obsidian.Plugin {
    async onload() {
        await this.loadSettings();

        // Add settings tab
        this.addSettingTab(new GoogleKeepSyncSettingTab(this.app, this));

        // Add command to sync
        this.addCommand({
            id: 'sync-notes',
            name: 'Sync Notes',
            callback: () => this.runKeepSync()
        });

        // Setup background intervals and startup sync
        this.app.workspace.onLayoutReady(() => {
            if (this.settings.syncOnStartup) {
                // Wait 5 seconds after layout ready so startup isn't bogged down
                setTimeout(() => this.runKeepSync(), 5000);
            }
            this.setupIntervalSync();
        });
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    async runKeepSync() {
        const fs = require('fs');
        const path = require('path');
        const { spawn } = require('child_process');
        
        const vaultPath = this.app.vault.adapter.getBasePath();
        const scriptDir = path.join(vaultPath, '.obsidian', 'plugins', 'google-keep-sync');
        const scriptPath = path.join(scriptDir, 'kim.py');
        
        if (!fs.existsSync(scriptPath)) {
            new obsidian.Notice(`Google Keep script not found at ${scriptPath}`);
            return;
        }
        
        new obsidian.Notice("Syncing Google Keep notes...");
        
        // Retrieve master token securely from Keychain
        let secretId = this.settings.googleKeepTokenId || 'google-keep-master-token';
        const keepToken = await Promise.resolve(this.app.secretStorage.getSecret(secretId)) || '';
        
        // Build env variables
        const env = Object.assign({}, process.env, {
            OPENSSL_CONF: '',
            KIM_TOKEN: keepToken,
            KIM_GOOGLE_USERID: this.settings.googleUserid,
            KIM_OUTPUT_PATH: path.isAbsolute(this.settings.outputPath) ? this.settings.outputPath : path.join(vaultPath, this.settings.outputPath),
            KIM_EXCLUDE_TITLES: this.settings.excludeTitles,
            KIM_QUICKLOG_TITLE: this.settings.quicklogTitle,
            KIM_LOG_HEADER: this.settings.logHeader
        });
        
        // Add daily note path
        const todayStr = new Date().toISOString().split('T')[0];
        const dailyNotePath = path.join(vaultPath, '02_Journal', '01_Daily', `${todayStr}.md`);
        if (fs.existsSync(dailyNotePath)) {
            env.KIM_DAILY_NOTE_PATH = dailyNotePath;
        }
        
        // Run python kim.py (using the virtual environment's python if available)
        let pythonCmd = 'python';
        const venvPython = path.join(scriptDir, 'venv', 'Scripts', 'python.exe');
        if (fs.existsSync(venvPython)) {
            pythonCmd = venvPython;
        }
        
        const child = spawn(pythonCmd, [scriptPath, '-b', '--all', '-m'], { 
            cwd: scriptDir,
            env: env
        });
        
        let stdout = '';
        let stderr = '';
        
        child.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        
        child.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        child.on('close', (code) => {
            if (code === 0) {
                new obsidian.Notice("Google Keep sync completed successfully!");
                console.log("Keep sync output:\n", stdout);
            } else {
                if (stderr.includes("Username or password is incorrect") || stderr.includes("BadAuthentication")) {
                    new obsidian.Notice("Keep Sync Failed: Master Token is invalid or expired. Please generate a new one in the Google Keep Sync settings.", 8000);
                } else {
                    new obsidian.Notice(`Keep sync failed. Check console.`);
                }
                console.error("Keep sync error:\n", stderr);
            }
        });
    }

    async saveTokenToKeyring(username, token) {
        if (!username || !token) return;
        
        const fs = require('fs');
        const path = require('path');
        const { spawn } = require('child_process');
        
        const vaultPath = this.app.vault.adapter.getBasePath();
        const scriptDir = path.join(vaultPath, '.obsidian', 'plugins', 'google-keep-sync');
        let pythonCmd = 'python';
        const venvPython = path.join(scriptDir, 'venv', 'Scripts', 'python.exe');
        if (fs.existsSync(venvPython)) {
            pythonCmd = venvPython;
        }
        
        const pythonScript = `
import keyring, sys
try:
    keyring.set_password('google-keep-token', sys.argv[1], sys.argv[2])
    print('SUCCESS')
except Exception as e:
    sys.stderr.write(str(e))
`;
        const env = Object.assign({}, process.env, {
            OPENSSL_CONF: process.platform === 'win32' ? 'NUL' : '/dev/null'
        });
        
        return new Promise((resolve) => {
            const child = spawn(pythonCmd, ['-c', pythonScript, username, token], {
                cwd: scriptDir,
                env: env
            });
            let stderr = '';
            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            child.on('close', (code) => {
                if (code !== 0) {
                    console.error("Failed to sync token to system keyring:", stderr);
                }
                resolve(code === 0);
            });
        });
    }

    setupIntervalSync() {
        if (this.syncInterval) {
            window.clearInterval(this.syncInterval);
            this.syncInterval = null;
        }
        if (this.settings.enableIntervalSync) {
            const minutes = Math.max(1, this.settings.intervalSyncMinutes || 360);
            this.syncInterval = window.setInterval(() => this.runKeepSync(), minutes * 60 * 1000);
            this.registerInterval(this.syncInterval);
        }
    }
}

class KeepTokenHelpModal extends obsidian.Modal {
    constructor(app, plugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: 'How to Obtain a Google Keep Master Token' });
        
        const vaultPath = this.app.vault.adapter.getBasePath();
        const scriptDir = require('path').join(vaultPath, '.obsidian', 'plugins', 'google-keep-sync');
        const email = this.plugin.settings.googleUserid || 'your-email@gmail.com';
        
        const desc = contentEl.createDiv({ cls: 'keep-help-content' });
        desc.innerHTML = `
            <p>Google Keep requires a long-lived <strong>Master Token</strong> (which starts with <code>oauth2rt_1/...</code> or <code>aas_et/...</code>). You cannot paste the short-lived cookie directly.</p>
            
            <h3>Step 1: Obtain the temporary OAuth Cookie</h3>
            <ol>
                <li>Open a new browser tab and go to <a href="https://accounts.google.com/EmbeddedSetup" target="_blank">Google EmbeddedSetup</a>.</li>
                <li>Log into the Google Account associated with your Google Keep notes.</li>
                <li>Once logged in (you see a blank page or "success" text), open Developer Tools (press <code>F12</code> or <code>Ctrl+Shift+I</code> / <code>Cmd+Opt+I</code>).</li>
                <li>Go to the <strong>Application</strong> (Chrome/Edge/Brave) or <strong>Storage</strong> (Firefox) tab.</li>
                <li>Expand <strong>Cookies</strong> on the left and select <code>https://accounts.google.com</code>.</li>
                <li>Find the cookie named <code>oauth_token</code> and copy its value (it starts with <code>oauth2_4/...</code>). This cookie is short-lived and expires in 5 minutes.</li>
            </ol>

            <h3>Step 2: Exchange it for a Master Token</h3>
            <ol>
                <li>Open PowerShell or your command terminal.</li>
                <li>Change directory to your GoogleKeepSync plugin folder:
                    <pre><code>cd "${scriptDir.replace(/\\/g, '\\\\')}"</code></pre>
                </li>
                <li>Run the token exchange helper script:
                    <pre><code>& ".\\venv\\Scripts\\python.exe" get_token.py</code></pre>
                </li>
                <li>Enter your Google email (<code>${email}</code>), paste the copied cookie (starting with <code>oauth2_4/...</code>), and enter a dummy Android ID (e.g. <code>1234567890abcdef</code>).</li>
                <li>Copy the resulting Master Token (starts with <code>oauth2rt_1/...</code> or <code>aas_et/...</code>) printed by the script and paste it into the "Google Keep Master Token" settings field.</li>
            </ol>
            <p style="font-size: 0.9em; color: var(--text-muted);"><em>Note: Treat the Master Token as securely as a password. It is stored safely in your computer's native system keychain.</em></p>
        `;
    }

    onClose() {
        const { contentEl } = this;
        contentEl.empty();
    }
}

class GoogleKeepSyncSettingTab extends obsidian.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        try {
            const { containerEl } = this;
            containerEl.empty();
            containerEl.createEl('h2', { text: 'Google Keep Sync Settings' });

            new obsidian.Setting(containerEl)
                .setName('Google Username')
                .setDesc('Your Google Account email address used for Google Keep.')
                .addText(text => text
                    .setPlaceholder('username@gmail.com')
                    .setValue(this.plugin.settings.googleUserid)
                    .onChange(async (value) => {
                        const newUserid = value.trim();
                        this.plugin.settings.googleUserid = newUserid;
                        await this.plugin.saveSettings();
                    }));

            new obsidian.Setting(containerEl)
                .setName('Imports Target Folder')
                .setDesc('Folder relative to vault root where keeping notes are converted to markdown.')
                .addText(text => text
                    .setPlaceholder('00_Imports')
                    .setValue(this.plugin.settings.outputPath)
                    .onChange(async (value) => {
                        this.plugin.settings.outputPath = value.trim();
                        await this.plugin.saveSettings();
                    }));

            containerEl.createEl('h3', { text: 'API Credentials (Keychain)' });

            // Google Keep Master Token (Password input)
            new obsidian.Setting(containerEl)
                .setName('Google Keep Master Token')
                .setDesc('Secure long-lived master token stored in your system keychain.')
                .addText(text => {
                    text.inputEl.type = 'password';
                    text.setPlaceholder('Enter Google Keep Master Token');
                    let secretId = this.plugin.settings.googleKeepTokenId;
                    if (!secretId) {
                        secretId = 'google-keep-master-token';
                        this.plugin.settings.googleKeepTokenId = secretId;
                        this.plugin.saveSettings();
                    }
                    Promise.resolve(this.app.secretStorage.getSecret(secretId)).then(value => {
                        text.setValue(value || '');
                    });
                    text.onChange(async (value) => {
                        const trimmedVal = value.trim();
                        await this.app.secretStorage.setSecret(secretId, trimmedVal);
                        if (trimmedVal.startsWith("oauth2rt_1/") || trimmedVal.startsWith("aas_et/")) {
                            await this.plugin.saveTokenToKeyring(this.plugin.settings.googleUserid, trimmedVal);
                        }
                    });
                });

            // Temporary Cookie section inside a card
            let tempCookie = "";
            
            const cardEl = containerEl.createDiv({
                style: 'border: 1px solid var(--background-modifier-border); border-radius: 8px; padding: 16px; margin: 16px 0; background-color: var(--background-primary-alt);'
            });
            
            cardEl.createEl('h4', { 
                text: 'Temporary Cookie Exchange Helper',
                style: 'margin-top: 0; margin-bottom: 8px;' 
            });
            
            cardEl.createEl('p', { 
                text: 'Paste the temporary cookie token starting with oauth2_4/ here to exchange it for a secure, long-lived Master Token.',
                style: 'font-size: 0.9em; color: var(--text-muted); margin-bottom: 12px; margin-top: 0;'
            });

            const inputRow = cardEl.createDiv({ 
                style: 'display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 12px;' 
            });

            const textInput = new obsidian.TextComponent(inputRow);
            textInput.setPlaceholder('oauth2_4/0...');
            textInput.inputEl.style.flex = '1';
            textInput.inputEl.style.minWidth = '200px';
            textInput.onChange(value => {
                tempCookie = value.trim();
            });

            const buttonsRow = cardEl.createDiv({ 
                style: 'display: flex; gap: 8px; justify-content: flex-start; flex-wrap: wrap;' 
            });

            const convertBtn = new obsidian.ButtonComponent(buttonsRow);
            convertBtn.setButtonText("Convert to Master Token");
            convertBtn.setCta();
            convertBtn.onClick(async () => {
                const email = this.plugin.settings.googleUserid;
                if (!email) {
                    new obsidian.Notice("Please enter your Google Username first!");
                    return;
                }
                if (!tempCookie) {
                    new obsidian.Notice("Please paste the Temporary OAuth Cookie first!");
                    return;
                }
                
                convertBtn.setDisabled(true);
                convertBtn.setButtonText("Converting...");
                new obsidian.Notice("Converting OAuth cookie to Master Token...");
                
                const fs = require('fs');
                const path = require('path');
                const { spawn } = require('child_process');
                
                const vaultPath = this.app.vault.adapter.getBasePath();
                const scriptDir = path.join(vaultPath, '.obsidian', 'plugins', 'google-keep-sync');
                let pythonCmd = 'python';
                const venvPython = path.join(scriptDir, 'venv', 'Scripts', 'python.exe');
                if (fs.existsSync(venvPython)) {
                    pythonCmd = venvPython;
                }
                
                const pythonScript = `
import gpsoauth, keyring, sys
try:
    res = gpsoauth.exchange_token(sys.argv[1], sys.argv[2], '1234567890abcdef')
    token = res.get('Token') if res and 'Token' in res else None
    if token and (token.startswith('oauth2rt_1/') or token.startswith('aas_et/')):
        keyring.set_password('google-keep-token', sys.argv[1], token)
    print(token if token else res)
except Exception as e:
    sys.stderr.write(str(e))
`;
                
                const child = spawn(pythonCmd, ['-c', pythonScript, email, tempCookie], {
                    cwd: scriptDir,
                    env: Object.assign({}, process.env, {
                        OPENSSL_CONF: ''
                    })
                });
                
                let stdout = "";
                let stderr = "";
                
                child.stdout.on('data', data => {
                    stdout += data.toString();
                });
                
                child.stderr.on('data', data => {
                    stderr += data.toString();
                });
                
                child.on('close', async (code) => {
                    convertBtn.setDisabled(false);
                    convertBtn.setButtonText("Convert to Master Token");
                    
                    const tokenVal = stdout.trim();
                    if (code === 0 && (tokenVal.startsWith("oauth2rt_1/") || tokenVal.startsWith("aas_et/"))) {
                        let secretId = this.plugin.settings.googleKeepTokenId || 'google-keep-master-token';
                        await this.app.secretStorage.setSecret(secretId, tokenVal);
                        new obsidian.Notice("Success! Master Token successfully obtained and stored securely.");
                        
                        // Refresh settings tab display
                        this.display();
                    } else {
                        const errMsg = tokenVal || stderr.trim() || "Unknown error";
                        new obsidian.Notice("Failed: " + errMsg);
                        console.error("Token exchange error:", errMsg);
                    }
                });
            });

            const helpBtn = new obsidian.ButtonComponent(buttonsRow);
            helpBtn.setButtonText("How to get Cookie");
            helpBtn.onClick(() => {
                new KeepTokenHelpModal(this.app, this.plugin).open();
            });

            containerEl.createEl('h3', { text: 'Synchronization Customizations' });

            // Skipped Note Titles
            new obsidian.Setting(containerEl)
                .setName('Skipped Note Titles')
                .setDesc('Comma-separated list of Google Keep note titles to exclude from vault sync.')
                .addText(text => text
                    .setPlaceholder('Shopping, Wishlist')
                    .setValue(this.plugin.settings.excludeTitles)
                    .onChange(async (value) => {
                        this.plugin.settings.excludeTitles = value;
                        await this.plugin.saveSettings();
                    }));

            // Quicklog Title
            new obsidian.Setting(containerEl)
                .setName('Quicklog List Title')
                .setDesc('Title of your Google Keep list that acts as a quick capture inbox (items get synced and cleared).')
                .addText(text => text
                    .setPlaceholder('Quicklog')
                    .setValue(this.plugin.settings.quicklogTitle)
                    .onChange(async (value) => {
                        this.plugin.settings.quicklogTitle = value.trim();
                        await this.plugin.saveSettings();
                    }));

            // Log Header Section
            new obsidian.Setting(containerEl)
                .setName('Daily Note Log Section Header')
                .setDesc('Markdown header in your Daily Note under which Quicklog items will be appended.')
                .addText(text => text
                    .setPlaceholder('## 🪵 Log')
                    .setValue(this.plugin.settings.logHeader)
                    .onChange(async (value) => {
                        this.plugin.settings.logHeader = value.trim();
                        await this.plugin.saveSettings();
                    }));

            containerEl.createEl('h3', { text: 'Automated Synchronization' });

            // Sync on Startup Toggle
            new obsidian.Setting(containerEl)
                .setName('Sync on Startup')
                .setDesc('Sync notes automatically when Obsidian opens.')
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.syncOnStartup)
                    .onChange(async (value) => {
                        this.plugin.settings.syncOnStartup = value;
                        await this.plugin.saveSettings();
                    }));

            // Enable Interval Sync Toggle
            new obsidian.Setting(containerEl)
                .setName('Interval Sync')
                .setDesc('Sync notes automatically at a regular interval.')
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.enableIntervalSync)
                    .onChange(async (value) => {
                        this.plugin.settings.enableIntervalSync = value;
                        await this.plugin.saveSettings();
                        this.plugin.setupIntervalSync();
                        this.display(); // Refresh to show/hide interval duration setting
                    }));

            // Interval Duration (Minutes)
            if (this.plugin.settings.enableIntervalSync) {
                new obsidian.Setting(containerEl)
                    .setName('Sync Interval (Minutes)')
                    .setDesc('How often to run sync in the background.')
                    .addText(text => text
                        .setPlaceholder('360')
                        .setValue(String(this.plugin.settings.intervalSyncMinutes))
                        .onChange(async (value) => {
                            const val = parseInt(value, 10);
                            if (!isNaN(val) && val > 0) {
                                this.plugin.settings.intervalSyncMinutes = val;
                                await this.plugin.saveSettings();
                                this.plugin.setupIntervalSync();
                            }
                        }));
            }

        } catch (e) {
            console.error("Google Keep Sync settings tab display error:", e);
            new obsidian.Notice("Settings Display Error: " + e.message);
        }
    }
}

module.exports = GoogleKeepSyncPlugin;
