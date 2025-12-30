class GitHubMemo {
    constructor() {
        this.folders = [];
        this.memos = [];
        this.currentFolder = null;
        this.currentMemo = null;
        this.folderPasswords = new Map();
        
        // 从加密配置加载
        this.config = this.loadEncryptedConfig();
        
        // 删除相关
        this.pendingDelete = {
            type: null,
            id: null
        };
        
        this.init();
    }
    
    loadEncryptedConfig() {
        // 默认配置
        const defaultConfig = {
            username: '',
            repo: 'memo-data',
            token: '',
            storageType: 'local',
            configured: false
        };
        
        // 从localStorage加载加密配置
        const saved = localStorage.getItem('githubMemoConfig');
        if (!saved) {
            return defaultConfig;
        }
        
        try {
            const config = JSON.parse(saved);
            
            // 解密Token（如果有）
            if (config.token) {
                try {
                    config.token = atob(config.token);
                } catch (e) {
                    console.error('Token解密失败:', e);
                    config.token = '';
                }
            }
            
            config.configured = true;
            return config;
        } catch (error) {
            console.error('配置解析失败:', error);
            return defaultConfig;
        }
    }
    
    init() {
        if (!this.config.configured) {
            return;
        }
        
        this.initElements();
        this.bindEvents();
        this.loadData();
    }
    
    initElements() {
        // 文件夹相关
        this.foldersList = document.getElementById('foldersList');
        this.newFolderBtn = document.getElementById('newFolderBtn');
        this.currentFolderName = document.getElementById('currentFolderName');
        this.deleteFolderBtn = document.getElementById('deleteFolderBtn');
        
        // 备忘录相关
        this.memoGrid = document.getElementById('memoGrid');
        this.newMemoBtn = document.getElementById('newMemoBtn');
        this.memoListView = document.getElementById('memoListView');
        
        // 编辑器相关
        this.editorView = document.getElementById('editorView');
        this.memoTitle = document.getElementById('memoTitle');
        this.memoContent = document.getElementById('memoContent');
        this.saveMemoBtn = document.getElementById('saveMemoBtn');
        this.closeEditorBtn = document.getElementById('closeEditorBtn');
        this.deleteMemoBtn = document.getElementById('deleteMemoBtn');
        this.exportMemoBtn = document.getElementById('exportMemoBtn');
        this.charCount = document.getElementById('charCount');
        this.lastModified = document.getElementById('lastModified');
        
        // 其他按钮
        this.exportAllBtn = document.getElementById('exportAllBtn');
        this.lastSync = document.getElementById('lastSync');
        this.storageMode = document.getElementById('storageMode');
        
        // 更新存储模式显示
        if (this.storageMode) {
            this.storageMode.textContent = this.config.storageType === 'github' ? 'GitHub' : '本地';
        }
        
        // 模态框
        this.modalOverlay = document.getElementById('modalOverlay');
        this.newFolderModal = document.getElementById('newFolderModal');
        this.folderNameInput = document.getElementById('folderName');
        this.visibilityRadios = document.querySelectorAll('input[name="visibility"]');
        this.passwordGroup = document.getElementById('passwordGroup');
        this.folderPasswordInput = document.getElementById('folderPassword');
        this.createFolderBtn = document.getElementById('createFolderBtn');
        this.cancelFolderBtn = document.getElementById('cancelFolderBtn');
        
        this.passwordModal = document.getElementById('passwordModal');
        this.inputPassword = document.getElementById('inputPassword');
        this.submitPasswordBtn = document.getElementById('submitPasswordBtn');
        this.cancelPasswordBtn = document.getElementById('cancelPasswordBtn');
        
        this.confirmModal = document.getElementById('confirmModal');
        this.confirmMessage = document.getElementById('confirmMessage');
        this.confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
        this.cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
    }
    
    bindEvents() {
        // 文件夹事件
        this.newFolderBtn.addEventListener('click', () => this.showNewFolderModal());
        this.visibilityRadios.forEach(radio => {
            radio.addEventListener('change', (e) => {
                this.passwordGroup.classList.toggle('hidden', e.target.value === 'public');
            });
        });
        this.createFolderBtn.addEventListener('click', () => this.createFolder());
        this.cancelFolderBtn.addEventListener('click', () => this.hideModal(this.newFolderModal));
        this.deleteFolderBtn.addEventListener('click', () => this.promptDeleteFolder());
        
        // 密码事件
        this.submitPasswordBtn.addEventListener('click', () => this.verifyPassword());
        this.cancelPasswordBtn.addEventListener('click', () => this.hideModal(this.passwordModal));
        
        // 备忘录事件
        this.newMemoBtn.addEventListener('click', () => this.createMemo());
        this.saveMemoBtn.addEventListener('click', () => this.saveMemo());
        this.closeEditorBtn.addEventListener('click', () => this.closeEditor());
        this.deleteMemoBtn.addEventListener('click', () => this.promptDeleteMemo());
        this.exportMemoBtn.addEventListener('click', () => this.exportCurrentMemo());
        this.exportAllBtn.addEventListener('click', () => this.exportAllData());
        
        // 删除确认事件
        this.confirmDeleteBtn.addEventListener('click', () => this.executeDelete());
        this.cancelDeleteBtn.addEventListener('click', () => this.hideModal(this.confirmModal));
        
        // 编辑器输入事件
        this.memoContent.addEventListener('input', () => this.updateEditorInfo());
        this.memoTitle.addEventListener('input', () => this.updateEditorInfo());
        
        // 自动保存
        setInterval(() => {
            if (this.currentMemo) {
                this.saveMemoToGitHub();
            }
        }, 30000); // 每30秒自动保存
    }
    
    async loadData() {
        try {
            // 从GitHub加载数据
            const data = await this.fetchFromGitHub();
            if (data) {
                this.folders = data.folders || [];
                this.memos = data.memos || [];
                this.folderPasswords = new Map(data.passwords || []);
                this.renderFolders();
                this.updateLastSync();
            }
        } catch (error) {
            console.log('从GitHub加载数据失败，使用本地数据:', error);
            this.loadLocalData();
        }
    }
    
    async fetchFromGitHub() {
        // 如果不是GitHub存储模式，从本地加载
        if (this.config.storageType !== 'github') {
            return this.loadLocalData();
        }
        
        const { username, repo } = this.config;
        if (!username || !repo) return null;
        
        const url = `https://raw.githubusercontent.com/${username}/${repo}/main/data.json`;
        
        try {
            const response = await fetch(url);
            if (response.ok) {
                return await response.json();
            }
        } catch (error) {
            console.error('从GitHub加载数据失败:', error);
        }
        
        // 如果GitHub加载失败，尝试从本地加载
        return this.loadLocalData();
    }
    
    loadLocalData() {
        const localData = localStorage.getItem('memoLocalData');
        if (localData) {
            return JSON.parse(localData);
        }
        return null;
    }
    
    renderFolders() {
        this.foldersList.innerHTML = '';
        
        if (this.folders.length === 0) {
            this.foldersList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-folder-open"></i>
                    <p>暂无文件夹</p>
                </div>
            `;
            return;
        }
        
        this.folders.forEach(folder => {
            const folderEl = document.createElement('div');
            folderEl.className = 'folder-item';
            if (this.currentFolder?.id === folder.id) {
                folderEl.classList.add('active');
            }
            
            folderEl.innerHTML = `
                <div>
                    <i class="fas fa-folder folder-icon ${folder.visibility === 'private' ? 'folder-private' : ''}"></i>
                    ${this.escapeHtml(folder.name)}
                </div>
                ${folder.visibility === 'private' ? '<i class="fas fa-lock" title="密码保护"></i>' : ''}
            `;
            
            // 添加删除按钮
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'folder-delete-btn';
            deleteBtn.innerHTML = '<i class="fas fa-times"></i>';
            deleteBtn.title = '删除文件夹';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.promptDeleteFolder(folder.id);
            });
            
            folderEl.appendChild(deleteBtn);
            folderEl.addEventListener('click', () => this.selectFolder(folder));
            this.foldersList.appendChild(folderEl);
        });
    }
    
    showNewFolderModal() {
        this.folderNameInput.value = '';
        this.visibilityRadios[0].checked = true;
        this.passwordGroup.classList.add('hidden');
        this.folderPasswordInput.value = '';
        this.showModal(this.newFolderModal);
    }
    
    createFolder() {
        const name = this.folderNameInput.value.trim();
        if (!name) {
            alert('请输入文件夹名称');
            return;
        }
        
        const visibility = document.querySelector('input[name="visibility"]:checked').value;
        const password = visibility === 'private' ? this.folderPasswordInput.value : '';
        
        if (visibility === 'private' && password.length < 4) {
            alert('密码至少需要4位字符');
            return;
        }
        
        const folder = {
            id: Date.now().toString(),
            name: name,
            visibility: visibility,
            createdAt: new Date().toISOString()
        };
        
        this.folders.push(folder);
        
        if (visibility === 'private' && password) {
            this.folderPasswords.set(folder.id, btoa(password));
        }
        
        this.renderFolders();
        this.saveDataToGitHub();
        this.hideModal(this.newFolderModal);
        
        alert('文件夹创建成功！');
    }
    
    selectFolder(folder) {
        if (folder.visibility === 'private') {
            const hasAccess = this.folderPasswords.has(folder.id);
            if (!hasAccess) {
                this.currentFolder = folder;
                this.showPasswordModal();
                return;
            }
        }
        
        this.currentFolder = folder;
        this.currentMemo = null;
        
        // 更新UI
        document.querySelectorAll('.folder-item').forEach(el => el.classList.remove('active'));
        event.target.closest('.folder-item').classList.add('active');
        
        this.currentFolderName.textContent = folder.name;
        this.newMemoBtn.disabled = false;
        this.deleteFolderBtn.disabled = false;
        
        this.showMemoList();
        this.renderMemos();
    }
    
    showPasswordModal() {
        this.inputPassword.value = '';
        this.showModal(this.passwordModal);
        this.inputPassword.focus();
    }
    
    verifyPassword() {
        const password = this.inputPassword.value;
        if (!password) return;
        
        const storedPassword = this.folderPasswords.get(this.currentFolder.id);
        const enteredPassword = btoa(password);
        
        if (enteredPassword === storedPassword) {
            this.folderPasswords.set(this.currentFolder.id, storedPassword);
            this.hideModal(this.passwordModal);
            this.selectFolder(this.currentFolder);
        } else {
            alert('密码错误！');
            this.inputPassword.value = '';
            this.inputPassword.focus();
        }
    }
    
    showMemoList() {
        this.memoListView.classList.remove('hidden');
        this.editorView.classList.add('hidden');
    }
    
    showEditor() {
        this.memoListView.classList.add('hidden');
        this.editorView.classList.remove('hidden');
    }
    
    renderMemos() {
        if (!this.currentFolder) return;
        
        const folderMemos = this.memos.filter(memo => memo.folderId === this.currentFolder.id);
        
        this.memoGrid.innerHTML = '';
        
        if (folderMemos.length === 0) {
            this.memoGrid.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-sticky-note"></i>
                    <h3>暂无备忘录</h3>
                    <p>点击"新建备忘录"开始记录</p>
                </div>
            `;
            return;
        }
        
        folderMemos.forEach(memo => {
            const memoEl = document.createElement('div');
            memoEl.className = 'memo-card';
            
            // 预览内容（限制长度）
            const preview = memo.content.length > 200 ? 
                memo.content.substring(0, 200) + '...' : 
                memo.content;
            
            memoEl.innerHTML = `
                <h3>${this.escapeHtml(memo.title)}</h3>
                <div class="memo-content">${this.escapeHtml(preview)}</div>
                <div class="memo-date">${new Date(memo.updatedAt).toLocaleString('zh-CN')}</div>
            `;
            
            // 添加删除按钮
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'memo-action-btn';
            deleteBtn.innerHTML = '<i class="fas fa-trash"></i>';
            deleteBtn.title = '删除备忘录';
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                this.promptDeleteMemo(memo.id);
            });
            
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'memo-actions';
            actionsDiv.appendChild(deleteBtn);
            memoEl.appendChild(actionsDiv);
            
            memoEl.addEventListener('click', () => this.editMemo(memo.id));
            this.memoGrid.appendChild(memoEl);
        });
    }
    
    createMemo() {
        if (!this.currentFolder) return;
        
        this.currentMemo = {
            id: Date.now().toString(),
            folderId: this.currentFolder.id,
            title: '新备忘录',
            content: '',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        
        this.openEditor();
    }
    
    editMemo(memoId) {
        const memo = this.memos.find(m => m.id === memoId);
        if (memo) {
            this.currentMemo = memo;
            this.openEditor();
        }
    }
    
    openEditor() {
        this.memoTitle.value = this.currentMemo.title;
        this.memoContent.value = this.currentMemo.content;
        this.updateEditorInfo();
        this.showEditor();
        
        // 聚焦到标题
        setTimeout(() => {
            this.memoTitle.focus();
            this.memoTitle.select();
        }, 100);
    }
    
    closeEditor() {
        this.currentMemo = null;
        this.showMemoList();
    }
    
    updateEditorInfo() {
        if (!this.currentMemo) return;
        
        const charCount = this.memoContent.value.length + this.memoTitle.value.length;
        this.charCount.textContent = charCount;
        this.lastModified.textContent = '刚刚';
        
        // 更新当前备忘录
        this.currentMemo.title = this.memoTitle.value.trim() || '无标题';
        this.currentMemo.content = this.memoContent.value;
        this.currentMemo.updatedAt = new Date().toISOString();
    }
    
    saveMemo() {
        if (!this.currentMemo) return;
        
        // 如果是新备忘录，添加到列表
        const existingIndex = this.memos.findIndex(m => m.id === this.currentMemo.id);
        if (existingIndex === -1) {
            this.memos.unshift(this.currentMemo);
        } else {
            this.memos[existingIndex] = this.currentMemo;
        }
        
        this.saveDataToGitHub();
        this.renderMemos();
        this.closeEditor();
        
        alert('备忘录保存成功！');
    }
    
    async saveDataToGitHub() {
        try {
            const data = {
                folders: this.folders,
                memos: this.memos,
                passwords: Array.from(this.folderPasswords.entries()),
                lastUpdated: new Date().toISOString()
            };
            
            // 保存到本地存储作为备份
            localStorage.setItem('memoLocalData', JSON.stringify(data));
            
            // 如果配置了GitHub信息，尝试保存到GitHub
            if (this.config.username && this.config.repo && this.config.token) {
                await this.pushToGitHub(data);
                this.updateLastSync();
            }
            
            console.log('数据保存成功');
        } catch (error) {
            console.error('保存数据失败:', error);
            alert('数据保存失败，已保存到本地缓存');
        }
    }
    
    async pushToGitHub(data) {
        // 如果不是GitHub存储模式，只保存到本地
        if (this.config.storageType !== 'github') {
            console.log('本地存储模式，仅保存到localStorage');
            return;
        }
        
        if (!this.config.token) {
            console.log('无GitHub Token，仅保存到本地');
            return;
        }
        
        const { username, repo } = this.config;
        const apiUrl = `https://api.github.com/repos/${username}/${repo}/contents/data.json`;
        
        try {
            const content = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2))));
            
            // 先尝试获取文件sha
            let sha = null;
            try {
                const response = await fetch(apiUrl, {
                    headers: { 
                        'Authorization': `token ${this.config.token}`,
                        'Accept': 'application/vnd.github.v3+json'
                    }
                });
                if (response.ok) {
                    const fileInfo = await response.json();
                    sha = fileInfo.sha;
                }
            } catch (error) {
                // 文件不存在，创建新文件
            }
            
            const body = {
                message: `Update memo data ${new Date().toISOString()}`,
                content: content,
                sha: sha
            };
            
            const response = await fetch(apiUrl, {
                method: 'PUT',
                headers: {
                    'Authorization': `token ${this.config.token}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/vnd.github.v3+json'
                },
                body: JSON.stringify(body)
            });
            
            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'GitHub保存失败');
            }
            
            console.log('数据已保存到GitHub');
            return await response.json();
        } catch (error) {
            console.error('保存到GitHub失败:', error);
            // 保存到本地作为备份
            localStorage.setItem('memoLocalData', JSON.stringify(data));
            throw error;
        }
    }
    
    // 删除文件夹
    promptDeleteFolder(folderId = null) {
        const folder = folderId ? this.folders.find(f => f.id === folderId) : this.currentFolder;
        if (!folder) return;
        
        // 检查文件夹是否有备忘录
        const folderMemos = this.memos.filter(m => m.folderId === folder.id);
        
        this.pendingDelete = {
            type: 'folder',
            id: folder.id
        };
        
        let message = `确定要删除文件夹"${folder.name}"吗？`;
        if (folderMemos.length > 0) {
            message += `\n\n⚠️ 警告：该文件夹包含 ${folderMemos.length} 个备忘录，删除文件夹将同时删除这些备忘录！`;
        }
        
        this.confirmMessage.textContent = message;
        this.showModal(this.confirmModal);
    }
    
    // 删除备忘录
    promptDeleteMemo(memoId = null) {
        const memo = memoId ? this.memos.find(m => m.id === memoId) : this.currentMemo;
        if (!memo) return;
        
        this.pendingDelete = {
            type: 'memo',
            id: memo.id
        };
        
        this.confirmMessage.textContent = `确定要删除备忘录"${memo.title}"吗？`;
        this.showModal(this.confirmModal);
    }
    
    // 执行删除
    executeDelete() {
        if (!this.pendingDelete.type || !this.pendingDelete.id) return;
        
        if (this.pendingDelete.type === 'folder') {
            this.deleteFolder(this.pendingDelete.id);
        } else if (this.pendingDelete.type === 'memo') {
            this.deleteMemo(this.pendingDelete.id);
        }
        
        this.pendingDelete = { type: null, id: null };
        this.hideModal(this.confirmModal);
    }
    
    deleteFolder(folderId) {
        // 删除文件夹
        this.folders = this.folders.filter(f => f.id !== folderId);
        
        // 删除文件夹下的所有备忘录
        this.memos = this.memos.filter(m => m.folderId !== folderId);
        
        // 删除密码记录
        this.folderPasswords.delete(folderId);
        
        // 如果删除的是当前文件夹，清空当前选择
        if (this.currentFolder?.id === folderId) {
            this.currentFolder = null;
            this.currentMemo = null;
            this.currentFolderName.textContent = '请选择文件夹';
            this.newMemoBtn.disabled = true;
            this.deleteFolderBtn.disabled = true;
            this.showMemoList();
            this.memoGrid.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-sticky-note"></i>
                    <h3>请选择文件夹</h3>
                    <p>选择一个文件夹开始记录</p>
                </div>
            `;
        }
        
        this.renderFolders();
        this.saveDataToGitHub();
        
        alert('文件夹删除成功！');
    }
    
    deleteMemo(memoId) {
        // 删除备忘录
        this.memos = this.memos.filter(m => m.id !== memoId);
        
        // 如果删除的是当前备忘录，关闭编辑器
        if (this.currentMemo?.id === memoId) {
            this.closeEditor();
        }
        
        this.renderMemos();
        this.saveDataToGitHub();
        
        alert('备忘录删除成功！');
    }
    
    saveMemoToGitHub() {
        if (!this.currentMemo) return;
        
        // 更新当前备忘录
        this.currentMemo.title = this.memoTitle.value.trim() || '无标题';
        this.currentMemo.content = this.memoContent.value;
        this.currentMemo.updatedAt = new Date().toISOString();
        
        // 更新memos数组
        const existingIndex = this.memos.findIndex(m => m.id === this.currentMemo.id);
        if (existingIndex === -1) {
            this.memos.unshift(this.currentMemo);
        } else {
            this.memos[existingIndex] = this.currentMemo;
        }
        
        // 保存到GitHub
        this.saveDataToGitHub();
        console.log('自动保存完成');
    }
    
    exportCurrentMemo() {
        if (!this.currentMemo) return;
        
        const data = {
            memo: this.currentMemo,
            exportedAt: new Date().toISOString()
        };
        
        this.downloadJSON(data, `memo-${this.currentMemo.id}.json`);
    }
    
    exportAllData() {
        const data = {
            folders: this.folders,
            memos: this.memos,
            passwords: Array.from(this.folderPasswords.entries()),
            exportedAt: new Date().toISOString()
        };
        
        this.downloadJSON(data, 'memo-backup.json');
    }
    
    downloadJSON(data, filename) {
        const jsonStr = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }
    
    updateLastSync() {
        this.lastSync.textContent = new Date().toLocaleString('zh-CN');
    }
    
    showModal(modal) {
        this.modalOverlay.classList.remove('hidden');
        modal.classList.remove('hidden');
    }
    
    hideModal(modal) {
        this.modalOverlay.classList.add('hidden');
        modal.classList.add('hidden');
    }
    
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// 初始化应用
const app = new GitHubMemo();