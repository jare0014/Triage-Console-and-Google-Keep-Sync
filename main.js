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
    intervalSyncMinutes: 360,
    
    // AI Triage Console settings
    llmProvider: 'gemini',
    llmModel: 'gemini-2.5-flash',
    ollamaUrl: 'http://localhost:11434',
    geminiApiKeyId: 'google-keep-sync-gemini-key',
    todoistTokenId: 'google-keep-sync-todoist-token',
    incubationThresholdDays: 14,
    triageRules: [
        {
            category: "daughter_quote",
            displayName: "💬 Esther's Quotes",
            description: "a quote, funny saying, or conversation with a child/daughter (usually Esther or Amalia).",
            targetPath: "05_People/Esther.md",
            buttonLabel: "💬 Append to Esther",
            templatePath: "99_System/Templates/Person_Template.md"
        },
        {
            category: "bumper_sticker",
            displayName: "🚗 Jokes & Bumper Stickers",
            description: "funny bumper stickers, jokes, license plates, or humorous observations.",
            targetPath: "06_Entertainment/Bumper Stickers and License Plates List.md",
            buttonLabel: "🚗 Append to Stickers"
        },
        {
            category: "diary_entry",
            displayName: "📝 Diary & Journal Entries",
            description: "personal thoughts, logs, reflections, health notes, daily activities, or journal entries.",
            targetPath: "02_Journal/01_Daily/YYYY-MM-DD.md",
            buttonLabel: "📝 Log to Daily",
            templatePath: "99_System/Templates/Daily Note Template.md"
        },
        {
            category: "task",
            displayName: "✅ Tasks & Reminders",
            description: "a to-do, action item, reminder, chore, or shopping list item.",
            targetPath: "Todoist",
            buttonLabel: "✅ Todoist"
        },
        {
            category: "project_todo",
            displayName: "🚀 Project Tasks & Ideas",
            description: "an idea, task, bug, or feature request related to one of my projects.",
            targetPath: "04_Projects/",
            buttonLabel: "🚀 Append to Project"
        },
        {
            category: "chatbot_transcript",
            displayName: "💬 Chatbot Discussions",
            description: "a conversation transcript, chat history, or discussion with an AI chatbot (like Claude, ChatGPT, Gemini, etc.) related to a project.",
            targetPath: "04_Projects/",
            buttonLabel: "💬 Save to Chatbot"
        },
        {
            category: "article",
            displayName: "🎓 Articles & Web URLs",
            description: "any note that contains an external article, document, or Web URL link.",
            targetPath: "01_Incubator/",
            buttonLabel: "📥 Send to Incubator"
        },
        {
            category: "suggested_note",
            displayName: "📂 Evolving Logs & Topics",
            description: "any other general log, entity, reference, or idea that belongs in a specific file.",
            targetPath: "01_Inbox/",
            buttonLabel: "📝 Append"
        }
    ]
};

class GoogleKeepSyncPlugin extends obsidian.Plugin {
    async onload() {
        this.failedClassifying = new Set();
        await this.loadSettings();

        // Add settings tab
        this.addSettingTab(new GoogleKeepSyncSettingTab(this.app, this));

        // Add command to sync
        this.addCommand({
            id: 'sync-notes',
            name: 'Sync Notes',
            callback: () => this.runKeepSync()
        });

        // Register custom triage code block processor
        this.registerMarkdownCodeBlockProcessor("google-keep-triage", async (source, el, ctx) => {
            const moment = window.moment;
            el.empty();
            const wrapper = el.createDiv({ cls: 'google-keep-triage-console-wrapper' });
            wrapper.style.padding = '10px 0';
            
            const renderConsole = async () => {
                wrapper.empty();
                
                const sourceFolder = this.settings.outputPath || "00_Imports";
                const limit = 5;
                
                const markdownFiles = this.app.vault.getMarkdownFiles().filter(file => {
                    const norm = file.path.replace(/\\/g, '/');
                    return norm.startsWith(sourceFolder + '/') && file.name !== "00_Triage_Console.md" && !norm.includes('/media/');
                })
                .sort((a, b) => b.stat.ctime - a.stat.ctime)
                .slice(0, limit);

                // Check for expired imports (older than incubationThresholdDays)
                const thresholdDays = this.settings.incubationThresholdDays || 14;
                const expiredFiles = [];
                const nowMoment = moment();
                
                const allUnroutedFiles = this.app.vault.getMarkdownFiles().filter(file => {
                    const norm = file.path.replace(/\\/g, '/');
                    return norm.startsWith(sourceFolder + '/') && file.name !== "00_Triage_Console.md" && !norm.includes('/media/');
                });

                for (let file of allUnroutedFiles) {
                    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
                    if (fm && fm.triage_classified && fm.triage_category === 'article') {
                        const ctime = moment(file.stat.ctime);
                        const diffDays = nowMoment.diff(ctime, 'days');
                        if (diffDays >= thresholdDays) {
                            expiredFiles.push({ file, fm, age: diffDays });
                        }
                    }
                }

                if (expiredFiles.length > 0) {
                    const alertBox = wrapper.createDiv();
                    alertBox.style.backgroundColor = 'var(--background-secondary-alt)';
                    alertBox.style.border = '1px dashed var(--text-warning)';
                    alertBox.style.borderRadius = '8px';
                    alertBox.style.padding = '12px 16px';
                    alertBox.style.marginBottom = '20px';
                    alertBox.style.display = 'flex';
                    alertBox.style.justifyContent = 'space-between';
                    alertBox.style.alignItems = 'center';

                    const alertText = alertBox.createDiv();
                    alertText.innerHTML = `⚠️ <strong>Learning Queue Incubation Alert:</strong> You have <strong>${expiredFiles.length}</strong> unread article note(s) in the inbox that have been sitting there for more than ${thresholdDays} days.`;
                    alertText.style.color = 'var(--text-warning)';

                    const btnMoveExpired = alertBox.createEl('button', { text: '📥 Move all to Incubator' });
                    btnMoveExpired.style.backgroundColor = 'var(--text-warning)';
                    btnMoveExpired.style.color = 'var(--background-primary)';
                    btnMoveExpired.style.fontWeight = 'bold';
                    btnMoveExpired.onclick = async () => {
                        btnMoveExpired.disabled = true;
                        new obsidian.Notice(`Moving ${expiredFiles.length} expired articles to Incubator...`);
                        for (let expired of expiredFiles) {
                            const { file, fm } = expired;
                            let targetPath = fm.triage_suggested_path || `01_Incubator/${file.name}`;
                            if (!targetPath.startsWith("01_Incubator/")) {
                                targetPath = `01_Incubator/${file.name}`;
                            }
                            try {
                                await this.keepArticle(file, fm.triage_title || file.basename, fm.triage_url, fm.triage_summary || "None", targetPath, fm.triage_topic || "General Research");
                            } catch (e) {
                                console.error(`Failed to move expired file ${file.name}:`, e);
                            }
                        }
                        new obsidian.Notice("Expired articles successfully moved!");
                        await renderConsole();
                    };
                }
                
                // Auto-archiver
                const archiveFolder = this.app.vault.getAbstractFileByPath("99_Archive");
                if (archiveFolder) {
                    const allVaultFiles = this.app.vault.getMarkdownFiles();
                    let movedCount = 0;
                    for (let f of allVaultFiles) {
                        if (!f.path.startsWith("99_Archive/")) {
                            const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
                            if (fm && fm.status === "archived") {
                                try {
                                    let destFolder = "99_Archive/General";
                                    if (f.path.startsWith("00_Imports/")) {
                                        destFolder = "99_Archive/Clippings";
                                    } else if (f.path.startsWith("01_Incubator/")) {
                                        destFolder = "99_Archive/Incubator";
                                    }
                                    
                                    if (!this.app.vault.getAbstractFileByPath(destFolder)) {
                                        await this.app.vault.createFolder(destFolder);
                                    }
                                    await this.app.fileManager.renameFile(f, `${destFolder}/${f.name}`);
                                    movedCount++;
                                } catch(e) {
                                    console.error("Auto-archiving failed for:", f.path, e);
                                }
                            }
                        }
                    }
                    if (movedCount > 0) {
                        new obsidian.Notice(`📦 Auto-archived ${movedCount} notes to local 99_Archive.`);
                    }
                }
                
                // Check unclassified files
                const unclassified = [];
                for (let f of markdownFiles) {
                    if (this.failedClassifying && this.failedClassifying.has(f.path)) continue;
                    const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
                    const isGenericSummary = !fm.triage_summary || fm.triage_summary.startsWith("No summary available") || fm.triage_summary === "None";
                    const isGenericTitle = fm.triage_title && fm.triage_title.startsWith("Source ") && (fm.triage_title.includes("http") || fm.triage_title.includes("2026-"));
                    const needsReclassify = fm && fm.triage_category === 'article' && 
                        (!fm.triage_suggested_links || isGenericSummary || isGenericTitle);
                    if (!fm || fm.triage_classified !== true || needsReclassify) {
                        unclassified.push(f);
                    }
                }
                
                if (unclassified.length > 0) {
                    const progressEl = wrapper.createDiv({ 
                        text: `⏳ Classifying new imports (0/${unclassified.length})...`,
                    });
                    progressEl.style.fontSize = "1.1em";
                    progressEl.style.color = "var(--text-accent)";
                    progressEl.style.margin = "10px 0";
                    
                    let count = 0;
                    for (let f of unclassified) {
                        try {
                            await this.classifyFile(f);
                            // Check if it successfully classified
                            const updatedFm = this.app.metadataCache.getFileCache(f)?.frontmatter;
                            const stillNeedsReclassify = updatedFm && updatedFm.triage_category === 'article' && 
                                (!updatedFm.triage_suggested_links || !updatedFm.triage_summary || updatedFm.triage_summary === "No summary available." || updatedFm.triage_summary === "None");
                            if (!updatedFm || updatedFm.triage_classified !== true || stillNeedsReclassify) {
                                if (this.failedClassifying) this.failedClassifying.add(f.path);
                            }
                        } catch(e) {
                            console.error("Failed to classify:", f.name, e);
                            if (this.failedClassifying) this.failedClassifying.add(f.path);
                        }
                        count++;
                        progressEl.setText(`⏳ Classifying new imports (${count}/${unclassified.length})...`);
                    }
                    progressEl.remove();
                    await renderConsole();
                    return;
                }
                
                if (markdownFiles.length === 0) {
                    wrapper.createEl('h3', { 
                        text: '✅ All Clear',
                        style: 'color: var(--text-success); font-weight: bold; margin-top: 15px;'
                    });
                    return;
                }
                
                const groups = {};
                for (let f of markdownFiles) {
                    const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
                    if (fm && fm.triage_classified) {
                        const cat = fm.triage_category || "suggested_note";
                        if (!groups[cat]) groups[cat] = [];
                        groups[cat].push({ file: f, fm: fm });
                    } else {
                        if (!groups["suggested_note"]) groups["suggested_note"] = [];
                        groups["suggested_note"].push({ file: f, fm: { triage_suggested_path: "01_Inbox/" + f.name, triage_clean_content: f.basename } });
                    }
                }
                
                const batchContainer = wrapper.createDiv({ style: 'margin-bottom: 20px; display: flex; gap: 10px;' });
                const btnRouteAll = batchContainer.createEl("button", { text: "⚡ Approve & Route All" });
                btnRouteAll.style.backgroundColor = "var(--interactive-accent)";
                btnRouteAll.style.color = "var(--text-on-accent)";
                btnRouteAll.style.fontWeight = "bold";
                btnRouteAll.style.padding = "6px 16px";
                btnRouteAll.onclick = async () => {
                    new obsidian.Notice("Routing all categorized notes in batch...");
                    for (let cat in groups) {
                        if (cat === "article") continue;
                        for (let item of groups[cat]) {
                            const { file, fm } = item;
                            const path = fm.triage_suggested_path;
                            const cleanContent = fm.triage_clean_content || file.basename;
                            const date = fm.triage_date || moment().format("YYYY-MM-DD");
                            
                            try {
                                if (cat === "task") {
                                    await this.createTodoistTask(file, cleanContent);
                                } else if (cat === "diary_entry") {
                                    await this.logDiaryEntry(file, cleanContent, date);
                                } else if (cat === "project_todo") {
                                    await this.appendToProjectDevLog(file, path, cleanContent, date);
                                } else {
                                    await this.appendToNote(file, path, cleanContent, date);
                                }
                            } catch(e) {
                                console.error("Batch routing failed:", file.name, e);
                            }
                        }
                    }
                    new obsidian.Notice("Batch routing complete!");
                    await renderConsole();
                };
                
                if (this.failedClassifying && this.failedClassifying.size > 0) {
                    const btnRetry = batchContainer.createEl("button", { text: `🔄 Retry ${this.failedClassifying.size} Failed` });
                    btnRetry.style.padding = "6px 12px";
                    btnRetry.onclick = async () => {
                        this.failedClassifying.clear();
                        new obsidian.Notice("Retrying failed classifications...");
                        await renderConsole();
                    };
                }
                
                const rulesList = this.settings.triageRules || [];
                const categoriesInfo = {};
                for (const r of rulesList) {
                    categoriesInfo[r.category] = {
                        title: r.displayName || r.category,
                        buttonLabel: r.buttonLabel || "Move",
                        targetPath: r.targetPath
                    };
                }
                if (!categoriesInfo.suggested_note) {
                    categoriesInfo.suggested_note = { title: "📂 Evolving Logs & Topics", buttonLabel: "📝 Append" };
                }
                
                for (let cat of Object.keys(categoriesInfo)) {
                    const items = groups[cat];
                    if (!items || items.length === 0) continue;
                    
                    const info = categoriesInfo[cat];
                    wrapper.createEl('h3', { 
                        text: info.title, 
                        style: 'margin-top: 20px; border-bottom: 1px solid var(--background-modifier-border); padding-bottom: 5px;' 
                    });
                    
                    const tableContainer = wrapper.createDiv({ style: 'overflow-x: auto; margin-bottom: 15px;' });
                    const table = tableContainer.createEl('table');
                    table.style.width = '100%';
                    table.style.borderCollapse = 'collapse';
                    
                    const thead = table.createEl('thead');
                    const headerRow = thead.createEl('tr');
                    
                    const headers = cat === "article" 
                        ? ["Note", "Topic", "Target Suggestion", "Content / Summary", "Actions"]
                        : ["Note", "Target Suggestion", "Content / Summary", "Actions"];
                        
                    for (let h of headers) {
                        const th = headerRow.createEl('th', { text: h });
                        th.style.textAlign = 'left';
                        th.style.padding = '8px';
                        th.style.borderBottom = '2px solid var(--background-modifier-border)';
                    }
                    
                    const tbody = table.createEl('tbody');
                    
                    for (let item of items) {
                        const { file, fm } = item;
                        let targetPath = fm.triage_suggested_path || "01_Inbox/" + file.name;
                        if (targetPath.startsWith("03_Knowledge/")) {
                            targetPath = targetPath.replace("03_Knowledge/", "01_Incubator/");
                        }
                        const date = fm.triage_date || "";
                        
                        let displayContent = fm.triage_clean_content || file.basename;
                        if (cat === "article") {
                            const linksStr = fm.triage_suggested_links || "None";
                            displayContent = `<strong>Summary:</strong> ${fm.triage_summary || "None"}<br><strong>Suggested Links:</strong> ${linksStr}<br><a href="${fm.triage_url}" target="_blank">${fm.triage_url}</a>`;
                        }
                        
                        const targetFileExists = this.app.vault.getAbstractFileByPath(targetPath);
                        let targetDisplay = targetPath;
                        if (cat !== "task") {
                            targetDisplay += targetFileExists ? " (Exists)" : " (New Note)";
                        }
                        
                        const row = tbody.createEl('tr');
                        row.style.borderBottom = '1px solid var(--background-modifier-border)';
                        
                        // Column 1: Note Link
                        const tdNote = row.createEl('td');
                        tdNote.style.padding = '8px';
                        const aLink = tdNote.createEl('a', { text: file.basename, href: file.path, cls: 'internal-link' });
                        aLink.onclick = (e) => {
                            e.preventDefault();
                            this.app.workspace.getLeaf(false).openFile(file);
                        };
                        
                        // Column 2: Topic (only for article)
                        let topicInput = null;
                        if (cat === "article") {
                            const tdTopic = row.createEl('td');
                            tdTopic.style.padding = '8px';
                            topicInput = tdTopic.createEl("input");
                            topicInput.type = "text";
                            topicInput.value = fm.triage_topic || "General Research";
                            topicInput.style.width = "120px";
                            topicInput.style.padding = "4px";
                            topicInput.style.borderRadius = "4px";
                            topicInput.style.border = "1px solid var(--border-color)";
                            topicInput.onchange = async () => {
                                const newTopic = topicInput.value.trim();
                                await this.app.fileManager.processFrontMatter(file, fMatter => {
                                    fMatter['triage_topic'] = newTopic;
                                });
                            };
                        }
                        
                        // Column 3: Target Suggestion
                        const tdTarget = row.createEl('td');
                        tdTarget.style.padding = '8px';
                        let dateSelect = null;
                        if (cat === "diary_entry") {
                            // Render a dropdown with the last 7 days
                            dateSelect = tdTarget.createEl("select");
                            dateSelect.style.padding = "4px";
                            dateSelect.style.borderRadius = "4px";
                            dateSelect.style.border = "1px solid var(--border-color)";
                            
                            const dates = [];
                            for (let i = 0; i < 7; i++) {
                                const d = moment().subtract(i, 'days');
                                const label = i === 0 ? "Today" : i === 1 ? "Yesterday" : `${i} days ago`;
                                dates.push({ value: d.format("YYYY-MM-DD"), label: `${label} (${d.format("YYYY-MM-DD")})` });
                            }
                            
                            // If frontmatter date exists and is not in the list, prepend it
                            if (date && !dates.some(x => x.value === date)) {
                                dates.unshift({ value: date, label: `Extracted (${date})` });
                            }
                            
                            for (let d of dates) {
                                const opt = dateSelect.createEl("option", { text: d.label, value: d.value });
                                if (d.value === (date || moment().format("YYYY-MM-DD"))) {
                                    opt.selected = true;
                                }
                            }
                        } else {
                            tdTarget.setText(targetDisplay);
                        }
                        
                        // Column 4: Content/Summary
                        const tdContent = row.createEl('td');
                        tdContent.style.padding = '8px';
                        tdContent.innerHTML = displayContent;
                        
                        // Column 5: Actions
                        const tdActions = row.createEl('td');
                        tdActions.style.padding = '8px';
                        const actionContainer = tdActions.createDiv({ style: 'display: flex; gap: 6px; flex-wrap: wrap;' });
                        
                        let primaryBtnLabel = info.buttonLabel;
                        if (cat === "suggested_note" || cat === "general_note") {
                            const filename = targetPath.split("/").pop().replace(".md", "");
                            primaryBtnLabel = targetFileExists ? `📝 Append to ${filename}` : `➕ Create & Append to ${filename}`;
                        }
                        
                        const btnPrimary = actionContainer.createEl("button", { text: primaryBtnLabel });
                        btnPrimary.onclick = async () => {
                            btnPrimary.disabled = true;
                            if (cat === "task") {
                                await this.createTodoistTask(file, fm.triage_clean_content);
                            } else if (cat === "diary_entry") {
                                const chosenDate = dateSelect ? dateSelect.value : (date || moment().format("YYYY-MM-DD"));
                                await this.logDiaryEntry(file, fm.triage_clean_content, chosenDate);
                            } else if (cat === "project_todo") {
                                await this.appendToProjectDevLog(file, targetPath, fm.triage_clean_content, date);
                            } else if (cat === "chatbot_transcript") {
                                await this.saveChatbotTranscript(file, targetPath);
                            } else if (cat === "article") {
                                const finalTopic = topicInput ? topicInput.value.trim() : (fm.triage_topic || "General Research");
                                await this.keepArticle(file, fm.triage_title || file.basename, fm.triage_url, fm.triage_summary, targetPath, finalTopic);
                            } else {
                                await this.appendToNote(file, targetPath, fm.triage_clean_content, date);
                            }
                            await renderConsole();
                        };
                        
                        if (cat === "article") {
                            const btnArchive = actionContainer.createEl("button", { text: "📦 Archive" });
                            btnArchive.onclick = async () => {
                                btnArchive.disabled = true;
                                await this.archiveArticle(file, fm.triage_url, fm.triage_summary);
                                await renderConsole();
                            };
                        }
                        
                        const btnManual = actionContainer.createEl("button", { text: "📂 Manual" });
                        btnManual.onclick = () => {
                            const dropdown = document.createElement("select");
                            dropdown.style.padding = "2px";
                            dropdown.style.fontSize = "0.9em";
                            dropdown.innerHTML = `
                                <option value="">Move to...</option>
                                <option value="01_Inbox">📥 Inbox</option>
                                <option value="01_Incubator">❔ Incubator</option>
                                <option value="03_Knowledge">🎓 Knowledge (stub)</option>
                                <option value="todoist">✅ Todoist</option>
                            `;
                            dropdown.onchange = async () => {
                                const val = dropdown.value;
                                if (!val) return;
                                dropdown.disabled = true;
                                if (val === "todoist") {
                                    await this.createTodoistTask(file, fm.triage_clean_content || file.basename);
                                } else {
                                    if (val === "03_Knowledge") {
                                        await this.app.fileManager.processFrontMatter(file, fMatter => fMatter['status'] = 'stub');
                                    }
                                    await this.app.fileManager.renameFile(file, `${val}/${file.name}`);
                                    new obsidian.Notice(`Moved to ${val}`);
                                }
                                await renderConsole();
                            };
                            btnManual.replaceWith(dropdown);
                        };
                        
                        const btnTrash = actionContainer.createEl("button", { text: "🗑️" });
                        btnTrash.onclick = async () => {
                            btnTrash.disabled = true;
                            await this.app.vault.trash(file, true);
                            await renderConsole();
                        };
                    }
                }
            };
            
            await renderConsole();
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

    async triggerNotebookLMPodcast(targetPath) {
        try {
            const secretId = 'knowledge-pipeline-notebooklm-session';
            const sessionJson = await Promise.resolve(this.app.secretStorage.getSecret(secretId)) || '';
            if (!sessionJson) {
                new obsidian.Notice("NotebookLM is not authenticated. Skipping automatic podcast generation. Please configure it in settings.");
                return;
            }
            
            const pipelinePlugin = this.app.plugins.getPlugin('knowledge-pipeline');
            if (pipelinePlugin) {
                const path = require('path');
                const vaultPath = this.app.vault.adapter.getBasePath();
                const absoluteFilePath = path.join(vaultPath, targetPath);
                
                new obsidian.Notice(`Triggering NotebookLM Podcast generation for ${path.basename(targetPath)}...`);
                pipelinePlugin.runArtifactGeneratorForFile(absoluteFilePath, 'audio');
            } else {
                new obsidian.Notice("Knowledge Pipeline plugin is not enabled/installed. Cannot generate podcast automatically.");
            }
        } catch (e) {
            console.error("Failed to trigger NotebookLM podcast:", e);
        }
    }

    suggestLinks(keywords, topic, title) {
        const related = [];
        const allFiles = this.app.vault.getMarkdownFiles();
        
        const candidates = new Set();
        if (topic) candidates.add(topic.toLowerCase());
        if (keywords && Array.isArray(keywords)) {
            for (let kw of keywords) {
                candidates.add(kw.toLowerCase());
            }
        }
        
        const titleWords = title.toLowerCase().split(/[^a-zA-Z0-9]/).filter(w => w.length > 4);
        for (let w of titleWords) {
            if (!["about", "world", "article", "source", "review", "guide", "paper", "video", "notes"].includes(w)) {
                candidates.add(w);
            }
        }

        for (let file of allFiles) {
            const fileNameLower = file.basename.toLowerCase();
            if (file.path.startsWith("00_Imports/") || file.basename === title) continue;
            
            let match = false;
            for (let cand of candidates) {
                if (fileNameLower === cand || fileNameLower.includes(" " + cand) || fileNameLower.includes(cand + " ")) {
                    match = true;
                    break;
                }
            }
            if (match) {
                related.push(`[[${file.basename}]]`);
                if (related.length >= 4) break;
            }
        }
        return related.join(", ");
    }

    async ensurePeopleNotes(content) {
        const atNames = content.match(/@([A-Z][a-zA-Z0-9_-]+)/g) || [];
        const wikiNames = [];
        const wikiRegex = /\[\[([a-zA-Z0-9\s_-]+)(?:\|[^\]]*)?\]\]/g;
        let match;
        while ((match = wikiRegex.exec(content)) !== null) {
            wikiNames.push(match[1].trim());
        }

        const uniqueNames = new Set();
        for (let name of atNames) {
            uniqueNames.add(name.substring(1));
        }
        for (let name of wikiNames) {
            if (/^[A-Z][a-z]+(?:\s[A-Z][a-z]+)?$/.test(name)) {
                uniqueNames.add(name);
            }
        }

        const templateFile = this.app.vault.getAbstractFileByPath("99_System/Templates/Person_Template.md");
        let templateContent = "";
        if (templateFile) {
            templateContent = await this.app.vault.read(templateFile);
        }

        for (let name of uniqueNames) {
            const personPath = `05_People/${name}.md`;
            const exists = this.app.vault.getAbstractFileByPath(personPath);
            if (!exists) {
                let noteContent = templateContent 
                    ? templateContent.replace(/#\s+\[\/\[Person_Template\|Person_Template\]\/\]/g, `# [[${name}|${name}]]`).replace(/#\s+\[\[Person_Template\|Person_Template\]\]/g, `# [[${name}|${name}]]`)
                    : `# [[${name}]]\n\n`;
                
                const dirPath = "05_People";
                if (!this.app.vault.getAbstractFileByPath(dirPath)) {
                    await this.app.vault.createFolder(dirPath);
                }
                await this.app.vault.create(personPath, noteContent);
                new obsidian.Notice(`Generated people note for: ${name}`);
            }
        }

        let newContent = content;
        for (let name of uniqueNames) {
            const regex = new RegExp(`@${name}\\b`, 'g');
            newContent = newContent.replace(regex, `[[${name}]]`);
        }
        return newContent;
    }

    async appendToProjectDevLog(file, targetPath, cleanContent, dateStr) {
        let targetFile = this.app.vault.getAbstractFileByPath(targetPath);
        if (!targetFile) {
            new obsidian.Notice(`Error: Project dev log not found at ${targetPath}`);
            return;
        }

        let content = await this.app.vault.read(targetFile);
        let formattedDate = dateStr || new Date().toISOString().split('T')[0];
        
        cleanContent = await this.ensurePeopleNotes(cleanContent);
        
        const taskLine = `\n- [ ] ${cleanContent} (Added: ${formattedDate})\n`;

        let newContent;
        if (content.includes("## ToDo")) {
            const idx = content.indexOf("## ToDo") + "## ToDo".length;
            newContent = content.substring(0, idx) + "\n" + taskLine.trim() + "\n" + content.substring(idx);
        } else {
            newContent = content.trimEnd() + "\n\n## ToDo\n" + taskLine;
        }

        await this.app.vault.modify(targetFile, newContent);
        new obsidian.Notice(`Added task to project dev log: ${targetFile.basename}`);
        await this.app.vault.trash(file, true);
    }

    async saveChatbotTranscript(file, targetPath) {
        if (!targetPath) {
            new obsidian.Notice("Error: No suggested path for chatbot transcript.");
            return;
        }

        // Clean up metadata
        await this.app.fileManager.processFrontMatter(file, fm => {
            delete fm['triage_category'];
            delete fm['triage_classified'];
            delete fm['triage_suggested_path'];
            delete fm['triage_clean_content'];
            delete fm['triage_date'];
            delete fm['triage_title'];
            delete fm['triage_summary'];
            delete fm['triage_topic'];
            delete fm['triage_suggested_links'];
        });

        const dirPath = targetPath.substring(0, targetPath.lastIndexOf("/"));
        if (dirPath) {
            const parts = dirPath.split("/");
            let currentPath = "";
            for (let part of parts) {
                currentPath = currentPath ? `${currentPath}/${part}` : part;
                if (!this.app.vault.getAbstractFileByPath(currentPath)) {
                    await this.app.vault.createFolder(currentPath);
                }
            }
        }

        await this.app.fileManager.renameFile(file, targetPath);
        new obsidian.Notice(`Saved chatbot transcript to: ${targetPath}`);
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    findDuplicateUrl(url, currentFilePath) {
        if (!url) return null;
        const normalizedUrl = url.trim().toLowerCase().replace(/\/$/, "");
        
        const markdownFiles = this.app.vault.getMarkdownFiles();
        for (let file of markdownFiles) {
            if (file.path === currentFilePath) continue;
            const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
            if (fm) {
                const fmUrl = fm.url || fm.triage_url;
                if (fmUrl) {
                    const normFmUrl = String(fmUrl).trim().toLowerCase().replace(/\/$/, "");
                    if (normFmUrl === normalizedUrl) {
                        return file;
                    }
                }
            }
        }
        return null;
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

    async callLLM(prompt, isJson = false) {
        const provider = this.settings.llmProvider || 'gemini';
        const model = this.settings.llmModel || 'gemini-2.5-flash';
        const ollamaUrl = this.settings.ollamaUrl || 'http://localhost:11434';
        
        if (provider === 'ollama') {
            const url = `${ollamaUrl}/api/generate`;
            const body = {
                model: model,
                prompt: prompt,
                stream: false
            };
            if (isJson) {
                body.format = 'json';
            }
            const res = await obsidian.requestUrl({
                url: url,
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (res.status === 200) {
                return JSON.parse(res.text).response;
            }
            throw new Error(`Ollama error: ${res.status}`);
        } else {
            const keyId = this.settings.geminiApiKeyId || 'google-keep-sync-gemini-key';
            const apiKey = await Promise.resolve(this.app.secretStorage.getSecret(keyId)) || '';
            if (!apiKey) {
                throw new Error("Gemini API key is not configured in Google Keep Sync settings.");
            }
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
            const body = {
                contents: [{ parts: [{ text: prompt }] }]
            };
            if (isJson) {
                body.generationConfig = { responseMimeType: 'application/json' };
            }
            let retries = 3;
            let delay = 1500;
            for (let i = 0; i < retries; i++) {
                try {
                    const res = await obsidian.requestUrl({
                        url: url,
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body)
                    });
                    if (res.status === 200) {
                        const data = JSON.parse(res.text);
                        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
                        if (text) return text;
                        throw new Error("Empty response from Gemini.");
                    }
                    throw new Error(`Gemini error: ${res.status}`);
                } catch (e) {
                    const errMsg = (e.message || String(e)).toLowerCase();
                    const isTransient = errMsg.includes("503") || errMsg.includes("429") || errMsg.includes("500") || errMsg.includes("rate limit") || errMsg.includes("busy");
                    if (isTransient && i < retries - 1) {
                        const statusMatch = errMsg.match(/status (\d+)/);
                        const statusText = statusMatch ? statusMatch[1] : '503/429';
                        new obsidian.Notice(`Gemini API busy or rate-limited (status ${statusText}). Retrying in ${(delay/1000).toFixed(1)}s...`);
                        await new Promise(r => setTimeout(r, delay));
                        delay *= 2;
                    } else {
                        throw e;
                    }
                }
            }
        }
    }

    async scrapeUrl(url) {
        try {
            const response = await obsidian.requestUrl({
                url: url,
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
                }
            });
            if (response.status !== 200) return null;
            
            const htmlText = response.text;
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlText, "text/html");
            const title = doc.querySelector("title")?.textContent?.trim() || "";
            const paragraphs = Array.from(doc.querySelectorAll("p"))
                .map(p => p.textContent.trim())
                .filter(Boolean);
            const body = paragraphs.join(" ").substring(0, 3000);
            return { title, body };
        } catch (e) {
            console.log("Scrape failed (will fall back to URL analysis):", e.message || e);
            return null;
        }
    }

    async classifyFile(file) {
        const content = await this.app.vault.read(file);
        
        // Check if contains external URL
        const urls = content.match(/https?:\/\/[^\s\)\]\u200b]+/g);
        let targetUrl = null;
        if (urls) {
            for (let url of urls) {
                if (!url.includes('keep.google.com')) {
                    targetUrl = url.replace(/^[\[\(\{\s]+|[\]\)\}\s]+$/g, '');
                    break;
                }
            }
        }
        
        if (targetUrl) {
            const duplicateFile = this.findDuplicateUrl(targetUrl, file.path);
            if (duplicateFile) {
                new obsidian.Notice(`URL already exists in vault: "${duplicateFile.basename}". Trashing duplicate Keep import.`, 5000);
                await this.app.vault.trash(file, true);
                return;
            }
            const page = await this.scrapeUrl(targetUrl);
            let title = file.basename;
            let body = content;
            if (page) {
                body = page.body;
                if (page.title && page.title.length > 10) title = page.title;
            }
            
            const articlePrompt = `You are a personal reading assistant. Analyze this web page content.
URL: ${targetUrl}
Title: ${title}
Content: ${body}

Instructions:
1. Generate a concise 2-3 sentence summary of the article (do NOT use double quotes in the summary).
2. If the content above is empty, incomplete, or contains only a URL (meaning scraping failed), use your external knowledge of the URL or analyze the URL path/slug to infer a descriptive title, a 2-3 sentence summary of what the article is about, and a proper topic. Do NOT return "No summary available" or generic text.
3. Suggest a clean, descriptive title for the article. Do NOT use generic names like "Source Phys.org" or "Source Article".
4. Suggest a safe, clean filename for saving it in the vault (with .md extension, removing all characters that are invalid in Windows/Mac filenames: * " \\ / < > : | ?).
5. Suggest a concise one- or two-word topic classification (e.g. "Physics", "Artificial Intelligence", "Evolutionary Biology", "History", "Finance", etc.).
6. Suggest 2-3 key terms, names, or related topics in this vault that we should link this note to.

Response MUST be a JSON object with these exact keys:
{
  "summary": "the 2-3 sentence summary",
  "suggested_title": "a clean, descriptive title for the article",
  "suggested_filename": "Cleaned Article Title.md",
  "suggested_topic": "concise one- or two-word topic",
  "suggested_keywords": ["keyword1", "keyword2", "keyword3"]
}
`;
            
            let summary = "No summary available.";
            let cleanTitle = title;
            let cleanFilename = file.name;
            let suggestedTopic = "";
            let suggestedKeywords = [];
            
            try {
                const resText = await this.callLLM(articlePrompt, true);
                const result = JSON.parse(resText.replace(/```json|```/g, "").trim());
                summary = result.summary || "No summary available.";
                cleanTitle = result.suggested_title || title;
                cleanFilename = result.suggested_filename || file.name;
                suggestedTopic = result.suggested_topic || "";
                suggestedKeywords = result.suggested_keywords || [];
                cleanFilename = cleanFilename.replace(/[*"\\/<>:|?]/g, "").trim();
                if (!cleanFilename.endsWith(".md")) {
                    cleanFilename += ".md";
                }
            } catch (err) {
                console.error("LLM Article Analysis failed:", err);
                cleanFilename = file.basename.replace(/[*"\\/<>:|?]/g, "").trim() + ".md";
                cleanTitle = cleanFilename.replace(/\.md$/, "");
            }
            
            let topic = "General Research";
            if (suggestedTopic) {
                topic = suggestedTopic.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
            } else {
                const keywords = ["quantum", "ai", "physics", "biology", "brain", "neuroscience", "math", "software", "google", "git", "sql"];
                for (const kw of keywords) {
                    if (cleanTitle.toLowerCase().includes(kw)) {
                        topic = kw.charAt(0).toUpperCase() + kw.slice(1);
                        break;
                    }
                }
            }
            
            const suggestedLinks = this.suggestLinks(suggestedKeywords, topic, cleanTitle);
            
            await this.app.fileManager.processFrontMatter(file, fm => {
                fm['triage_category'] = 'article';
                fm['triage_classified'] = true;
                fm['triage_suggested_path'] = `01_Incubator/${cleanFilename}`;
                fm['triage_url'] = targetUrl;
                fm['triage_summary'] = summary;
                fm['triage_title'] = cleanTitle;
                fm['triage_topic'] = topic;
                fm['triage_suggested_links'] = suggestedLinks;
            });

            // Store newly imported web page notes inside "00_Imports/"
            const queueFolder = "00_Imports";
            const queuePath = `${queueFolder}/${cleanFilename}`;
            if (file.path !== queuePath) {
                await this.app.fileManager.renameFile(file, queuePath);
            }
            
            // Trigger NotebookLM podcast generation immediately
            this.triggerNotebookLMPodcast(queuePath);
        } else {
            // Build prompt dynamically from settings
            const rules = this.settings.triageRules || [];
            const categoriesPrompt = rules.map(r => `- "${r.category}": ${r.description}`).join("\n");
            const pathsPrompt = rules.map(r => `- ${r.displayName} -> "${r.targetPath}"`).join("\n");
            
            const devLogs = this.app.vault.getMarkdownFiles().filter(f => f.path.startsWith("04_Projects/") && f.name.endsWith("Dev Log.md"));
            const devLogsPrompt = devLogs.map(f => `- "${f.basename}" -> "${f.path}"`).join("\n");
            
            const prompt = `You are a personal assistant. Analyze the note below and classify it into one of these categories:
${categoriesPrompt}

Also, suggest a logical destination path in the Obsidian vault.
1. If the note belongs to a specific project (category "project_todo"), choose the exact matching project dev log path from this list:
${devLogsPrompt}
2. If the note is a chatbot transcript (category "chatbot_transcript"), select the matching project from the dev log list above, and suggest a destination path inside that project's folder under a subfolder named "Chatbot Discussions", formatted like:
   04_Projects/[Project Folder Name]/Chatbot Discussions/[Descriptive Note Title].md (e.g. if the project dev log is "04_Projects/Quant/Quant Finance Project Dev Log.md", suggest a path like "04_Projects/Quant/Chatbot Discussions/Quant Flight Simulator.md").
3. For other categories, suggest a logical path based on:
${pathsPrompt}

Extract the note's original creation date if available (in YYYY-MM-DD format).

Response MUST be a JSON object with these exact keys:
{
  "category": "matching_category_id",
  "suggested_path": "folder/filename.md",
  "clean_content": "the note content with stamps and Keep links at the bottom removed",
  "date": "YYYY-MM-DD"
}

Note details:
Title: ${file.basename}
Content: ${content}`;
            
            try {
                const resText = await this.callLLM(prompt, true);
                const result = JSON.parse(resText.replace(/```json|```/g, "").trim());
                await this.app.fileManager.processFrontMatter(file, fm => {
                    fm['triage_category'] = result.category;
                    fm['triage_classified'] = true;
                    fm['triage_suggested_path'] = result.suggested_path;
                    fm['triage_clean_content'] = result.clean_content;
                    fm['triage_date'] = result.date;
                });
            } catch (err) {
                console.error("Semantic classification failed:", err);
                const cleanName = file.basename.replace(/[*"\\/<>:|?]/g, "").trim() + ".md";
                await this.app.fileManager.processFrontMatter(file, fm => {
                    fm['triage_category'] = 'suggested_note';
                    fm['triage_classified'] = true;
                    fm['triage_suggested_path'] = '01_Inbox/' + cleanName;
                    fm['triage_clean_content'] = content;
                    fm['triage_date'] = new Date().toISOString().split('T')[0];
                });
            }
        }
    }

    async appendToNote(file, targetPath, cleanContent, dateStr) {
        cleanContent = await this.ensurePeopleNotes(cleanContent);
        let formattedDate = new Date().toISOString().split('T')[0];
        if (dateStr) {
            formattedDate = dateStr;
        }
        const dateHeader = `### ${formattedDate}`;
        const textToAppend = `\n\n${dateHeader}\n\n${cleanContent}\n`;
        
        let targetFile = this.app.vault.getAbstractFileByPath(targetPath);
        if (!targetFile) {
            let templateContent = "";
            if (targetPath.startsWith("05_People/")) {
                const templateFile = this.app.vault.getAbstractFileByPath("99_System/Templates/Person_Template.md");
                if (templateFile) {
                    templateContent = await this.app.vault.read(templateFile);
                    const name = targetPath.split("/").pop().replace(".md", "");
                    templateContent = templateContent.replace(/#\s+\[\[Person_Template\|Person_Template\]\]/, `# [[${name}|${name}]]`);
                }
            } else if (targetPath.startsWith("02_Journal/01_Daily/")) {
                const templateFile = this.app.vault.getAbstractFileByPath("99_System/Templates/Daily Note Template.md");
                if (templateFile) {
                    templateContent = await this.app.vault.read(templateFile);
                }
            }
            
            const dirPath = targetPath.substring(0, targetPath.lastIndexOf("/"));
            if (dirPath && !this.app.vault.getAbstractFileByPath(dirPath)) {
                await this.app.vault.createFolder(dirPath);
            }
            const initialContent = templateContent ? templateContent.trimEnd() + textToAppend : `# ${targetPath.split("/").pop().replace(".md", "")}\n\n${textToAppend}`;
            await this.app.vault.create(targetPath, initialContent);
            new obsidian.Notice(`Created new note: ${targetPath}`);
        } else {
            let content = await this.app.vault.read(targetFile);
            let newContent = content.trimEnd() + textToAppend;
            await this.app.vault.modify(targetFile, newContent);
        }
        await this.app.vault.trash(file, true);
    }

    async logDiaryEntry(file, cleanContent, dateStr) {
        cleanContent = await this.ensurePeopleNotes(cleanContent);
        let actualDateStr = new Date().toISOString().split('T')[0];
        if (dateStr) {
            actualDateStr = dateStr;
        }
        const targetPath = `02_Journal/01_Daily/${actualDateStr}.md`;
        const logLine = `\n\n### Quicklog (Keep Sync)\n\n${cleanContent}\n`;
        
        let dailyFile = this.app.vault.getAbstractFileByPath(targetPath);
        if (dailyFile) {
            let content = await this.app.vault.read(dailyFile);
            let lines = content.split("\n");
            let insertIdx = -1;
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].includes("### Quicklog")) {
                    insertIdx = i + 1;
                    break;
                }
            }
            if (insertIdx === -1) {
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].includes("## 🪵 Log")) {
                        insertIdx = i + 1;
                        break;
                    }
                }
            }
            
            if (insertIdx !== -1) {
                lines.splice(insertIdx, 0, logLine);
                await this.app.vault.modify(dailyFile, lines.join("\n"));
            } else {
                await this.app.vault.modify(dailyFile, content.trimEnd() + logLine);
            }
        } else {
            let templateContent = "";
            const templateFile = this.app.vault.getAbstractFileByPath("99_System/Templates/Daily Note Template.md");
            if (templateFile) {
                templateContent = await this.app.vault.read(templateFile);
                templateContent = templateContent.replace("scores:", `scores:\njournal: Daily Notes\njournal-date: ${actualDateStr}`);
            }
            const initialContent = templateContent ? templateContent.trimEnd() + logLine : `# ${actualDateStr}\n\n${logLine}`;
            await this.app.vault.create(targetPath, initialContent);
            new obsidian.Notice(`Created Daily Note: ${actualDateStr}`);
        }
        await this.app.vault.trash(file, true);
    }

    async createTodoistTask(file, text) {
        let tokenKey = this.settings.todoistTokenId || 'google-keep-sync-todoist-token';
        const todoistToken = await Promise.resolve(this.app.secretStorage.getSecret(tokenKey)) || '34e525beddd77da5fd11625a5dcc20d807e2924e';
        
        if (!todoistToken) {
            const todayStr = new Date().toISOString().split('T')[0];
            const dailyNotePath = `02_Journal/01_Daily/${todayStr}.md`;
            let dailyFile = this.app.vault.getAbstractFileByPath(dailyNotePath);
            const taskLine = `\n- [ ] ${text} #task`;
            if (dailyFile) {
                let content = await this.app.vault.read(dailyFile);
                await this.app.vault.modify(dailyFile, content.trimEnd() + taskLine);
                new obsidian.Notice(`Todoist Token missing: task added to today's Daily Note.`);
            }
        } else {
            try {
                const response = await obsidian.requestUrl({
                    url: "https://api.todoist.com/rest/v2/tasks",
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${todoistToken}`
                    },
                    body: JSON.stringify({ content: text })
                });
                if (response.status === 200 || response.status === 201) {
                    new obsidian.Notice(`Todoist task created: ${text}`);
                } else {
                    throw new Error(`Status ${response.status}`);
                }
            } catch(e) {
                console.error("Todoist API error:", e);
                const todayStr = new Date().toISOString().split('T')[0];
                const dailyNotePath = `02_Journal/01_Daily/${todayStr}.md`;
                let dailyFile = this.app.vault.getAbstractFileByPath(dailyNotePath);
                const taskLine = `\n- [ ] ${text} #task`;
                if (dailyFile) {
                    let content = await this.app.vault.read(dailyFile);
                    await this.app.vault.modify(dailyFile, content.trimEnd() + taskLine);
                    new obsidian.Notice(`Todoist API failed: task added to today's Daily Note.`);
                }
            }
        }
        await this.app.vault.trash(file, true);
    }

    async keepArticle(file, title, url, summary, targetPath, topic) {
        const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
        const suggestedLinks = fm?.triage_suggested_links || "";

        const structured = `---
url: ${url}
topic: ${topic || "General Research"}
summarization: "${summary.replace(/"/g, '\\"')}"
notebook_id: ""
status: candidate
---
# ${title}

**Original Source**: [${url}](${url})

## 📝 Summarization
${summary}

${suggestedLinks ? `## 🔗 Suggested Links\n${suggestedLinks}\n` : ""}
## 🛠️ NotebookLM Artifacts
\`\`\`meta-bind-button
label: 🧠 Generate Mind Map
icon: "git-branch"
style: primary
hidden: false
actions:
  - type: command
    command: knowledge-pipeline:generate-mind-map
\`\`\`
\`\`\`meta-bind-button
label: 🎙️ Generate Podcast (Audio)
icon: "headphones"
style: primary
hidden: false
actions:
  - type: command
    command: knowledge-pipeline:generate-podcast
\`\`\`
\`\`\`meta-bind-button
label: 🎬 Generate Cinematic Video
icon: "video"
style: primary
hidden: false
actions:
  - type: command
    command: knowledge-pipeline:generate-video
\`\`\`
`;
        await this.app.vault.modify(file, structured);
        const destPath = targetPath || `01_Incubator/${file.name}`;
        const dirPath = destPath.substring(0, destPath.lastIndexOf("/"));
        if (dirPath && !this.app.vault.getAbstractFileByPath(dirPath)) {
            await this.app.vault.createFolder(dirPath);
        }
        await this.app.fileManager.renameFile(file, destPath);
        new obsidian.Notice(`Sent article to Incubator: ${title}`);
    }

    async archiveArticle(file, url, summary) {
        await this.app.fileManager.processFrontMatter(file, fm => {
            fm['status'] = 'archived';
            fm['url'] = url;
            fm['summarization'] = summary;
        });
        const archiveExists = this.app.vault.getAbstractFileByPath("99_Archive");
        if (archiveExists) {
            const clipPath = "99_Archive/Clippings";
            if (!this.app.vault.getAbstractFileByPath(clipPath)) {
                await this.app.vault.createFolder(clipPath);
            }
            await this.app.fileManager.renameFile(file, `${clipPath}/${file.name}`);
            new obsidian.Notice(`Archived article to Clippings.`);
        } else {
            new obsidian.Notice(`Marked status: archived (Archive folder not local).`);
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

            // AI Triage & Routing Settings (Collapsible details card)
            containerEl.createEl('hr');
            const aiDetails = containerEl.createEl('details');
            aiDetails.style.marginBottom = '20px';
            aiDetails.style.border = '1px solid var(--background-modifier-border)';
            aiDetails.style.borderRadius = '6px';
            aiDetails.style.padding = '8px';
            const aiSummary = aiDetails.createEl('summary', { text: '🧠 AI Triage & Routing Settings' });
            aiSummary.style.cursor = 'pointer';
            aiSummary.style.fontSize = '1.2em';
            aiSummary.style.fontWeight = 'bold';
            aiSummary.style.color = 'var(--text-accent)';

            const aiContainer = aiDetails.createDiv();
            aiContainer.style.paddingTop = '10px';

            new obsidian.Setting(aiContainer)
                .setName('LLM Provider')
                .setDesc('Select the LLM provider for note triage.')
                .addDropdown(dropdown => dropdown
                    .addOption('gemini', 'Google Gemini')
                    .addOption('ollama', 'Local Ollama')
                    .setValue(this.plugin.settings.llmProvider || 'gemini')
                    .onChange(async (value) => {
                        this.plugin.settings.llmProvider = value;
                        await this.plugin.saveSettings();
                        this.display(); // Refresh to show/hide ollama specific settings
                    }));

            new obsidian.Setting(aiContainer)
                .setName('Model Name')
                .setDesc('Enter the exact model identifier (e.g. gemini-2.5-flash or qwen2.5:7b).')
                .addText(text => text
                    .setPlaceholder('gemini-2.5-flash')
                    .setValue(this.plugin.settings.llmModel || 'gemini-2.5-flash')
                    .onChange(async (value) => {
                        this.plugin.settings.llmModel = value.trim();
                        await this.plugin.saveSettings();
                    }));

            if (this.plugin.settings.llmProvider === 'ollama') {
                new obsidian.Setting(aiContainer)
                    .setName('Ollama Server URL')
                    .setDesc('Local URL for the Ollama API.')
                    .addText(text => text
                        .setPlaceholder('http://localhost:11434')
                        .setValue(this.plugin.settings.ollamaUrl || 'http://localhost:11434')
                        .onChange(async (value) => {
                            this.plugin.settings.ollamaUrl = value.trim();
                            await this.plugin.saveSettings();
                        }));
            }

            // Gemini API Key
            new obsidian.Setting(aiContainer)
                .setName('Gemini API Key')
                .setDesc('Secure API key stored in system keyring.')
                .addText(text => {
                    text.inputEl.type = 'password';
                    text.setPlaceholder('Enter Gemini API Key');
                    let keyId = this.plugin.settings.geminiApiKeyId || 'google-keep-sync-gemini-key';
                    this.plugin.settings.geminiApiKeyId = keyId;
                    this.plugin.saveSettings();
                    
                    Promise.resolve(this.app.secretStorage.getSecret(keyId)).then(value => {
                        text.setValue(value || '');
                    });
                    text.onChange(async (value) => {
                        await this.app.secretStorage.setSecret(keyId, value.trim());
                    });
                });

            // Todoist Token
            new obsidian.Setting(aiContainer)
                .setName('Todoist API Token')
                .setDesc('Secure Token for dispatching tasks to Todoist.')
                .addText(text => {
                    text.inputEl.type = 'password';
                    text.setPlaceholder('Enter Todoist API Token');
                    let keyId = this.plugin.settings.todoistTokenId || 'google-keep-sync-todoist-token';
                    this.plugin.settings.todoistTokenId = keyId;
                    this.plugin.saveSettings();
                    
                    Promise.resolve(this.app.secretStorage.getSecret(keyId)).then(value => {
                        text.setValue(value || '');
                    });
                    text.onChange(async (value) => {
                        await this.app.secretStorage.setSecret(keyId, value.trim());
                    });
                });

            // Incubation Threshold Setting
            new obsidian.Setting(aiContainer)
                .setName('Learning Queue Incubation Threshold (Days)')
                .setDesc('Number of days unread articles sit in the inbox/queue before triggering an incubation transfer alert.')
                .addText(text => text
                    .setPlaceholder('14')
                    .setValue(String(this.plugin.settings.incubationThresholdDays || 14))
                    .onChange(async (value) => {
                        const parsed = parseInt(value, 10);
                        if (!isNaN(parsed) && parsed > 0) {
                            this.plugin.settings.incubationThresholdDays = parsed;
                            await this.plugin.saveSettings();
                        }
                    }));

            // Triage Rules Configuration GUI
            aiContainer.createEl('h3', { text: 'Triage Console Rules Configuration' });
            
            const rulesListContainer = aiContainer.createDiv();
            rulesListContainer.style.border = '1px solid var(--background-modifier-border)';
            rulesListContainer.style.borderRadius = '8px';
            rulesListContainer.style.padding = '15px';
            rulesListContainer.style.marginBottom = '20px';
            rulesListContainer.style.backgroundColor = 'var(--background-primary-alt)';

            const renderTriageRules = () => {
                rulesListContainer.empty();
                const rules = this.plugin.settings.triageRules || [];

                if (rules.length === 0) {
                    const emptyMsg = rulesListContainer.createDiv({ text: 'No triage rules configured. Create one below!' });
                    emptyMsg.style.color = 'var(--text-muted)';
                    emptyMsg.style.marginBottom = '10px';
                } else {
                    rules.forEach((rule, index) => {
                        const ruleRow = rulesListContainer.createDiv();
                        ruleRow.style.borderBottom = '1px solid var(--background-modifier-border)';
                        ruleRow.style.paddingBottom = '15px';
                        ruleRow.style.marginBottom = '15px';
                        ruleRow.style.display = 'flex';
                        ruleRow.style.flexDirection = 'column';
                        ruleRow.style.gap = '8px';

                        const headerRow = ruleRow.createDiv();
                        headerRow.style.display = 'flex';
                        headerRow.style.justifyContent = 'space-between';
                        headerRow.style.alignItems = 'center';

                        const ruleTitle = headerRow.createEl('strong', { text: rule.displayName || rule.category || 'New Rule' });
                        ruleTitle.style.color = 'var(--text-accent)';

                        const btnContainer = headerRow.createDiv();
                        btnContainer.style.display = 'flex';
                        btnContainer.style.gap = '4px';

                        const upBtn = btnContainer.createEl('button', { text: '▲' });
                        upBtn.disabled = index === 0;
                        upBtn.onclick = async () => {
                            const temp = rules[index - 1];
                            rules[index - 1] = rule;
                            rules[index] = temp;
                            await this.plugin.saveSettings();
                            renderTriageRules();
                        };

                        const downBtn = btnContainer.createEl('button', { text: '▼' });
                        downBtn.disabled = index === rules.length - 1;
                        downBtn.onclick = async () => {
                            const temp = rules[index + 1];
                            rules[index + 1] = rule;
                            rules[index] = temp;
                            await this.plugin.saveSettings();
                            renderTriageRules();
                        };

                        const delBtn = btnContainer.createEl('button', { text: '🗑' });
                        delBtn.style.color = 'var(--text-error)';
                        delBtn.onclick = async () => {
                            rules.splice(index, 1);
                            await this.plugin.saveSettings();
                            renderTriageRules();
                        };

                        const inputsGrid = ruleRow.createDiv();
                        inputsGrid.style.display = 'grid';
                        inputsGrid.style.gridTemplateColumns = '1fr 1fr';
                        inputsGrid.style.gap = '10px';

                        const catContainer = inputsGrid.createDiv();
                        catContainer.createEl('label', { text: 'Category / Key:' }).style.fontSize = '0.85em';
                        const catInput = catContainer.createEl('input', { type: 'text', value: rule.category });
                        catInput.style.width = '100%';
                        catInput.onchange = async () => {
                            rule.category = catInput.value.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
                            await this.plugin.saveSettings();
                        };

                        const nameContainer = inputsGrid.createDiv();
                        nameContainer.createEl('label', { text: 'Display Name:' }).style.fontSize = '0.85em';
                        const nameInput = nameContainer.createEl('input', { type: 'text', value: rule.displayName });
                        nameInput.style.width = '100%';
                        nameInput.onchange = async () => {
                            rule.displayName = nameInput.value.trim();
                            ruleTitle.textContent = rule.displayName || rule.category || 'New Rule';
                            await this.plugin.saveSettings();
                        };

                        const pathContainer = inputsGrid.createDiv();
                        pathContainer.createEl('label', { text: 'Target Path (e.g. Folder/File.md or YYYY-MM-DD.md):' }).style.fontSize = '0.85em';
                        const pathInput = pathContainer.createEl('input', { type: 'text', value: rule.targetPath });
                        pathInput.style.width = '100%';
                        pathInput.onchange = async () => {
                            rule.targetPath = pathInput.value.trim();
                            await this.plugin.saveSettings();
                        };

                        const labelContainer = inputsGrid.createDiv();
                        labelContainer.createEl('label', { text: 'Console Button Label:' }).style.fontSize = '0.85em';
                        const labelInput = labelContainer.createEl('input', { type: 'text', value: rule.buttonLabel || '' });
                        labelInput.style.width = '100%';
                        labelInput.onchange = async () => {
                            rule.buttonLabel = labelInput.value.trim();
                            await this.plugin.saveSettings();
                        };

                        const descRow = ruleRow.createDiv();
                        descRow.createEl('label', { text: 'Rule Description (LLM Instructions for classification):' }).style.fontSize = '0.85em';
                        const descInput = descRow.createEl('input', { type: 'text', value: rule.description });
                        descInput.style.width = '100%';
                        descInput.onchange = async () => {
                            rule.description = descInput.value.trim();
                            await this.plugin.saveSettings();
                        };

                        const tempContainer = ruleRow.createDiv();
                        tempContainer.createEl('label', { text: 'Optional Template Path (for new notes):' }).style.fontSize = '0.85em';
                        const tempInput = tempContainer.createEl('input', { type: 'text', value: rule.templatePath || '' });
                        tempInput.style.width = '100%';
                        tempInput.onchange = async () => {
                            rule.templatePath = tempInput.value.trim();
                            await this.plugin.saveSettings();
                        };
                    });
                }

                const addRow = rulesListContainer.createDiv();
                addRow.style.display = 'flex';
                addRow.style.gap = '8px';
                addRow.style.marginTop = '15px';
                addRow.style.paddingTop = '15px';
                addRow.style.borderTop = '2px dashed var(--background-modifier-border)';
                addRow.style.alignItems = 'center';

                const addBtn = addRow.createEl('button', { text: '＋ Add Triage Rule', cls: 'mod-cta' });
                addBtn.onclick = async () => {
                    rules.push({
                        category: "new_category",
                        displayName: "📂 New Rule Display",
                        description: "LLM prompt classification details.",
                        targetPath: "01_Inbox/new_file.md",
                        buttonLabel: "📝 Append to File"
                    });
                    await this.plugin.saveSettings();
                    renderTriageRules();
                };
            };

            renderTriageRules();

        } catch (e) {
            console.error("Google Keep Sync settings tab display error:", e);
            new obsidian.Notice("Settings Display Error: " + e.message);
        }
    }
}

module.exports = GoogleKeepSyncPlugin;
