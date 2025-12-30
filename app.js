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
            console.log('未配置，等待用户配置');
            return;
        }
        
        this.initElements();
        this.bindEvents();
        this.loadData();
    }
    
    initElements() {
        console.log('初始化元素...');
        
        // 文件夹相关
        this.foldersList = document.getElementById('foldersList');
        this.newFolderBtn = document.getElementById('newFolderBtn');
        this.currentFolderName = document.getElementById('currentFolderName');
        this.deleteFolderBtn = document.getElementById('deleteFolderBtn');
        
        // 备忘录相关
        this.memoGrid = document.getElementById('memoGrid');
        this.newMemoBtn = document.getElementById('newMemoBtn');
        this.memoListView = document.getElementById('memoListView');
        
        // 编辑器相关 - 修复：确保正确获取元素
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
        
        // 模态框元素
        this.modalOverlay = document.getElementById('modalOverlay');
        this.newFolderModal = document.getElementById('newFolderModal');
        
        if (this.newFolderModal) {
            this.folderNameInput = document.getElementById('folderName');
            this.visibilityRadios = this.newFolderModal.querySelectorAll('input[name="visibility"]');
            this.passwordGroup = document.getElementById('passwordGroup');
            this.folderPasswordInput = document.getElementById('folderPassword');
            this.createFolderBtn = document.getElementById('createFolderBtn');
            this.cancelFolderBtn = document.getElementById('cancelFolderBtn');
        }
        
        this.passwordModal = document.getElementById('passwordModal');
        if (this.passwordModal) {
            this.inputPassword = document.getElementById('inputPassword');
            this.submitPasswordBtn = document.getElementById('submitPasswordBtn');
            this.cancelPasswordBtn = document.getElementById('cancelPasswordBtn');
        }
        
        this.confirmModal = document.getElementById('confirmModal');
        if (this.confirmModal) {
            this.confirmMessage = document.getElementById('confirmMessage');
            this.confirmDeleteBtn = document.getElementById('confirmDeleteBtn');
            this.cancelDeleteBtn = document.getElementById('cancelDeleteBtn');
        }
        
        console.log('元素初始化完成');
    }
    
    bindEvents() {
        console.log('绑定事件...');
        
        // 文件夹事件
        if (this.newFolderBtn) {
            this.newFolderBtn.addEventListener('click', () => this.showNewFolderModal());
        }
        
        // 模态框内的事件绑定
        if (this.visibilityRadios) {
            this.visibilityRadios.forEach(radio => {
                radio.addEventListener('change', (e) => {
                    if (this.passwordGroup) {
                        this.passwordGroup.classList.toggle('hidden', e.target.value === 'public');
                    }
                });
            });
        }
        
        if (this.createFolderBtn) {
            this.createFolderBtn.addEventListener('click', () => this.createFolder());
        }
        
        if (this.cancelFolderBtn) {
            this.cancelFolderBtn.addEventListener('click', () => this.hideModal(this.newFolderModal));
        }
        
        if (this.deleteFolderBtn) {
            this.deleteFolderBtn.addEventListener('click', () => this.promptDeleteFolder());
        }
        
        // 密码事件
        if (this.submitPasswordBtn) {
            this.submitPasswordBtn.addEventListener('click', () => this.verifyPassword());
        }
        
        if (this.cancelPasswordBtn) {
            this.cancelPasswordBtn.addEventListener('click', () => this.hideModal(this.passwordModal));
        }
        
        // 备忘录事件 - 修复：确保按钮可用
        if (this.newMemoBtn) {
            this.newMemoBtn.addEventListener('click', () => this.createMemo());
        }
        
        if (this.saveMemoBtn) {
            this.saveMemoBtn.addEventListener('click', () => this.saveMemo());
        }
        
        if (this.closeEditorBtn) {
            this.closeEditorBtn.addEventListener('click', () => this.closeEditor());
        }
        
        if (this.deleteMemoBtn) {
            this.deleteMemoBtn.addEventListener('click', () => this.promptDeleteMemo());
        }
        
        if (this.exportMemoBtn) {
            this.exportMemoBtn.addEventListener('click', () => this.exportCurrentMemo());
        }
        
        if (this.exportAllBtn) {
            this.exportAllBtn.addEventListener('click', () => this.exportAllData());
        }
        
        // 删除确认事件
        if (this.confirmDeleteBtn) {
            this.confirmDeleteBtn.addEventListener('click', () => this.executeDelete());
        }
        
        if (this.cancelDeleteBtn) {
            this.cancelDeleteBtn.addEventListener('click', () => this.hideModal(this.confirmModal));
        }
        
        // 编辑器输入事件
        if (this.memoContent) {
            this.memoContent.addEventListener('input', () => this.updateEditorInfo());
        }
        
        if (this.memoTitle) {
            this.memoTitle.addEventListener('input', () => this.updateEditorInfo());
        }
        
        console.log('事件绑定完成');
    }
    
    async loadData() {
        console.log('加载数据...');
        try {
            // 从GitHub加载数据
            const data = await this.fetchFromGitHub();
            if (data) {
                this.folders = data.folders || [];
                this.memos = data.memos || [];
                this.folderPasswords = new Map(data.passwords || []);
                this.renderFolders();
                this.updateLastSync();
            } else {
                // 如果没有数据，初始化空数组
                this.folders = [];
                this.memos = [];
                this.folderPasswords = new Map();
                this.renderFolders();
            }
            console.log('数据加载完成');
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
            } else if (response.status === 404) {
                // 文件不存在，返回null
                return null;
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
        console.log('渲染文件夹...');
        if (!this.foldersList) return;
        
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
            
            // 修复：使用正确的点击事件
            folderEl.addEventListener('click', (e) => {
                // 确保点击的不是删除按钮
                if (!e.target.closest('.folder-delete-btn')) {
                    this.selectFolder(folder);
                }
            });
            
            this.foldersList.appendChild(folderEl);
        });
    }
    
    showNewFolderModal() {
        console.log('显示新建文件夹模态框');
        if (!this.newFolderModal || !this.folderNameInput) return;
        
        this.folderNameInput.value = '';
        
        // 重置单选按钮
        if (this.visibilityRadios && this.visibilityRadios.length > 0) {
            this.visibilityRadios[0].checked = true;
        }
        
        if (this.passwordGroup) {
            this.passwordGroup.classList.add('hidden');
        }
        
        if (this.folderPasswordInput) {
            this.folderPasswordInput.value = '';
        }
        
        this.showModal(this.newFolderModal);
    }
    
    createFolder() {
        console.log('创建文件夹...');
        if (!this.folderNameInput) return;
        
        const name = this.folderNameInput.value.trim();
        if (!name) {
            alert('请输入文件夹名称');
            return;
        }
        
        const visibility = document.querySelector('input[name="visibility"]:checked');
        if (!visibility) {
            alert('请选择权限设置');
            return;
        }
        
        const visibilityValue = visibility.value;
        const password = visibilityValue === 'private' && this.folderPasswordInput ? 
            this.folderPasswordInput.value : '';
        
        if (visibilityValue === 'private' && password.length < 4) {
            alert('密码至少需要4位字符');
            return;
        }
        
        const folder = {
            id: Date.now().toString(),
            name: name,
            visibility: visibilityValue,
            createdAt: new Date().toISOString()
        };
        
        this.folders.push(folder);
        
        if (visibilityValue === 'private' && password) {
            this.folderPasswords.set(folder.id, btoa(password));
        }
        
        this.renderFolders();
        this.saveDataToGitHub();
        this.hideModal(this.newFolderModal);
        
        alert('文件夹创建成功！');
    }
    
    selectFolder(folder) {
        console.log('选择文件夹:', folder.name);
        if (folder.visibility === 'private') {
            const hasAccess = this.folderPasswords.has(folder.id);
            if (!hasAccess) {
                this.currentFolder = folder;
                this.showPasswordModal();
                return;
            }
        }
        
        this.currentFolder = folder;
        this.currentMemo = null; // 修复：清空当前备忘录
        
        // 更新UI
        document.querySelectorAll('.folder-item').forEach(el => el.classList.remove('active'));
        
        // 找到并激活当前文件夹
        const folderItems = document.querySelectorAll('.folder-item');
        folderItems.forEach((item, index) => {
            if (this.folders[index] && this.folders[index].id === folder.id) {
                item.classList.add('active');
            }
        });
        
        this.currentFolderName.textContent = folder.name;
        
        // 修复：确保新建备忘录按钮可用
        if (this.newMemoBtn) {
            this.newMemoBtn.disabled = false;
        }
        
        if (this.deleteFolderBtn) {
            this.deleteFolderBtn.disabled = false;
        }
        
        this.showMemoList();
        this.renderMemos();
    }
    
    showPasswordModal() {
        if (!this.passwordModal || !this.inputPassword) return;
        
        this.inputPassword.value = '';
        this.showModal(this.passwordModal);
        this.inputPassword.focus();
    }
    
    verifyPassword() {
        if (!this.inputPassword || !this.currentFolder) return;
        
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
        if (!this.memoListView || !this.editorView) return;
        
        this.memoListView.classList.remove('hidden');
        this.editorView.classList.add('hidden');
        this.currentMemo = null; // 修复：清空当前备忘录
    }
    
    showEditor() {
        if (!this.memoListView || !this.editorView) return;
        
        this.memoListView.classList.add('hidden');
        this.editorView.classList.remove('hidden');
    }
    
    renderMemos() {
        if (!this.currentFolder || !this.memoGrid) return;
        
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
        console.log('创建备忘录...');
        if (!this.currentFolder) {
            alert('请先选择文件夹');
            return;
        }
        
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
        console.log('编辑备忘录:', memoId);
        const memo = this.memos.find(m => m.id === memoId);
        if (memo) {
            this.currentMemo = memo;
            this.openEditor();
        }
    }
    
    openEditor() {
        console.log('打开编辑器');
        if (!this.memoTitle || !this.memoContent) return;
        
        this.memoTitle.value = this.currentMemo.title;
        this.memoContent.value = this.currentMemo.content;
        this.updateEditorInfo();
        this.showEditor();
        
        // 聚焦到标题
        setTimeout(() => {
            if (this.memoTitle) {
                this.memoTitle.focus();
                this.memoTitle.select();
            }
        }, 100);
    }
    
    closeEditor() {
        console.log('关闭编辑器');
        this.currentMemo = null; // 修复：清空当前备忘录
        this.showMemoList();
        
        // 修复：重新渲染备忘录列表
        this.renderMemos();
    }
    
    updateEditorInfo() {
        if (!this.currentMemo || !this.charCount || !this.lastModified) return;
        
        const charCount = this.memoContent.value.length + this.memoTitle.value.length;
        this.charCount.textContent = charCount;
        this.lastModified.textContent = '刚刚';
        
        // 更新当前备忘录
        this.currentMemo.title = this.memoTitle.value.trim() || '无标题';
        this.currentMemo.content = this.memoContent.value;
        this.currentMemo.updatedAt = new Date().toISOString();
    }
    
    saveMemo() {
        console.log('保存备忘录');
        if (!this.currentMemo) return;
        
        // 如果是新备忘录，添加到列表
        const existingIndex = this.memos.findIndex(m => m.id === this.currentMemo.id);
        if (existingIndex === -1) {
            this.memos.unshift(this.currentMemo);
        } else {
            this.memos[existingIndex] = this.currentMemo;
        }
        
        this.saveDataToGitHub();
        this.closeEditor(); // 修复：保存后关闭编辑器
        
        alert('备忘录保存成功！');
    }
    
    async saveDataToGitHub() {
        console.log('保存数据到GitHub...');
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
    
    // 其他方法保持不变...
    
    // ...（保持原有的deleteFolder、deleteMemo等方法）...
}

// 初始化应用
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM已加载，初始化应用...');
    window.app = new GitHubMemo();
});