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
        
        // 同步相关
        this.syncInterval = null;
        this.lastSyncTime = 0;
        this.lastRemoteHash = '';
        this.localChanges = []; // 本地变更队列
        this.syncing = false; // 同步锁，防止重复同步
        this.conflictResolved = false;
        
        // 数据版本控制
        this.dataVersion = 0;
        this.lastDataHash = '';
        
        // 自动保存相关
        this.autoSaveTimer = null;
        this.autoSaveDelay = 2000; // 2秒自动保存
        this.hasUnsavedChanges = false;
    }
    
    loadEncryptedConfig() {
        console.log('加载配置...');
        
        // 默认配置
        const defaultConfig = {
            username: '',
            repo: 'memo-data',
            token: '',
            storageType: 'local',
            configured: false
        };
        
        // 首先检查URL参数（优先级最高）
        const urlParams = new URLSearchParams(window.location.search);
        const configFromUrl = this.getConfigFromUrlParams(urlParams);
        
        if (configFromUrl && configFromUrl.configured) {
            console.log('从URL参数加载配置成功');
            // 清除URL参数，避免重复加载
            this.clearUrlParams();
            return configFromUrl;
        }
        
        // 如果没有URL参数，从localStorage加载
        const saved = localStorage.getItem('githubMemoConfig');
        if (!saved) {
            console.log('没有找到本地配置');
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
            console.log('从localStorage加载配置成功');
            return config;
        } catch (error) {
            console.error('配置解析失败:', error);
            return defaultConfig;
        }
    }
    
    getConfigFromUrlParams(urlParams) {
        const encodedConfig = urlParams.get('config');
        if (!encodedConfig) return null;
        
        try {
            // 解码URL参数
            const decoded = decodeURIComponent(encodedConfig);
            const config = JSON.parse(decoded);
            
            // 验证必要字段
            if (!config.username || !config.repo || !config.token) {
                console.log('URL配置缺少必要字段');
                return null;
            }
            
            console.log('从URL参数解析配置成功:', config.username, config.repo);
            
            // 保存到localStorage，方便下次使用
            const configToSave = {
                ...config,
                configuredAt: new Date().toISOString()
            };
            
            // 加密Token后保存
            configToSave.token = btoa(config.token);
            localStorage.setItem('githubMemoConfig', JSON.stringify(configToSave));
            
            // 返回解密后的配置
            return {
                ...config,
                configured: true
            };
        } catch (error) {
            console.error('URL参数解析失败:', error);
            return null;
        }
    }
    
    clearUrlParams() {
        // 清除URL参数，避免刷新时重复加载
        if (window.history.replaceState) {
            const url = new URL(window.location);
            url.searchParams.delete('config');
            window.history.replaceState({}, '', url);
        }
    }
    
    // 新增：生成分享链接的方法
    generateShareLink() {
        if (!this.config.username || !this.config.repo || !this.config.token) {
            alert('请先配置GitHub信息');
            return null;
        }
        
        // 准备分享的配置（不包括敏感文件夹密码）
        const shareConfig = {
            username: this.config.username,
            repo: this.config.repo,
            token: this.config.token,
            storageType: this.config.storageType,
            sharedAt: new Date().toISOString(),
            note: 'GitHub备忘录配置链接 - 请在24小时内使用'
        };
        
        // 编码为URL参数
        const encoded = encodeURIComponent(JSON.stringify(shareConfig));
        const baseUrl = window.location.origin + window.location.pathname;
        const shareLink = `${baseUrl}?config=${encoded}`;
        
        return {
            link: shareLink,
            config: shareConfig
        };
    }
    
    // 新增：显示分享配置的模态框
    showShareConfigModal() {
        const shareData = this.generateShareLink();
        if (!shareData) return;
        
        // 创建分享模态框
        const modal = document.createElement('div');
        modal.className = 'modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h3><i class="fas fa-share-alt"></i> 分享配置</h3>
                <p>复制以下链接，在其他设备上打开即可自动配置：</p>
                
                <div class="share-link-container">
                    <input type="text" id="shareLinkInput" class="form-control" value="${shareData.link}" readonly>
                    <button id="copyShareLinkBtn" class="btn btn-primary">
                        <i class="fas fa-copy"></i> 复制链接
                    </button>
                </div>
                
                <div class="config-info">
                    <p><strong>包含的配置信息：</strong></p>
                    <ul>
                        <li>用户名: ${shareData.config.username}</li>
                        <li>仓库: ${shareData.config.repo}</li>
                        <li>存储类型: ${shareData.config.storageType === 'github' ? 'GitHub存储' : '本地存储'}</li>
                    </ul>
                </div>
                
                <div class="share-warning">
                    <i class="fas fa-exclamation-triangle"></i>
                    <div>
                        <p><strong>安全提示：</strong></p>
                        <p>1. 此链接包含您的GitHub Token，请谨慎分享！</p>
                        <p>2. 建议在24小时内使用此链接</p>
                        <p>3. 分享后可在GitHub上撤销Token</p>
                    </div>
                </div>
                
                <div class="modal-actions">
                    <button id="closeShareModalBtn" class="btn btn-secondary">关闭</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        
        // 添加遮罩层
        const overlay = document.getElementById('modalOverlay');
        if (overlay) {
            overlay.classList.remove('hidden');
        }
        modal.classList.remove('hidden');
        
        // 绑定事件
        const copyBtn = modal.querySelector('#copyShareLinkBtn');
        const closeBtn = modal.querySelector('#closeShareModalBtn');
        const shareInput = modal.querySelector('#shareLinkInput');
        
        copyBtn.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            
            shareInput.select();
            document.execCommand('copy');
            
            // 显示复制成功提示
            const originalText = copyBtn.innerHTML;
            copyBtn.innerHTML = '<i class="fas fa-check"></i> 已复制';
            copyBtn.disabled = true;
            
            setTimeout(() => {
                copyBtn.innerHTML = originalText;
                copyBtn.disabled = false;
            }, 2000);
        });
        
        closeBtn.addEventListener('click', () => {
            modal.remove();
            if (overlay) {
                overlay.classList.add('hidden');
            }
        });
        
        // 点击遮罩层关闭
        if (overlay) {
            const closeOverlay = () => {
                modal.remove();
                overlay.classList.add('hidden');
                overlay.removeEventListener('click', closeOverlay);
            };
            overlay.addEventListener('click', closeOverlay);
        }
    }
    
    init() {
        console.log('初始化应用...配置状态:', this.config.configured);
        
        // 检查是否有配置
        if (!this.config.configured) {
            console.log('未配置，跳转到配置页面');
            // 延迟跳转，避免立即重定向
            setTimeout(() => {
                if (!window.location.href.includes('config.html')) {
                    window.location.href = 'config.html';
                }
            }, 100);
            return;
        }
        
        this.initElements();
        this.bindEvents();
        this.loadData();
        
        // 启动自动同步
        this.startAutoSync();
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
        this.shareConfigBtn = document.getElementById('shareConfigBtn');
        
        // 更新存储模式显示
        if (this.storageMode) {
            this.storageMode.textContent = this.config.storageType === 'github' ? 'GitHub' : '本地';
        }
        
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
            console.log('绑定新建文件夹按钮');
            this.newFolderBtn.addEventListener('click', (e) => {
                console.log('点击新建文件夹按钮');
                e.preventDefault();
                e.stopPropagation();
                this.showNewFolderModal();
            });
        }
        
        // 模态框内的事件绑定
        if (this.visibilityRadios && this.visibilityRadios.length > 0) {
            this.visibilityRadios.forEach(radio => {
                radio.addEventListener('change', (e) => {
                    if (this.passwordGroup) {
                        this.passwordGroup.classList.toggle('hidden', e.target.value === 'public');
                    }
                });
            });
        }
        
        if (this.createFolderBtn) {
            this.createFolderBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.createFolder();
            });
        }
        
        if (this.cancelFolderBtn) {
            this.cancelFolderBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.hideModal(this.newFolderModal);
            });
        }
        
        if (this.deleteFolderBtn) {
            this.deleteFolderBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.promptDeleteFolder();
            });
        }
        
        // 密码事件
        if (this.submitPasswordBtn) {
            this.submitPasswordBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.verifyPassword();
            });
        }
        
        if (this.cancelPasswordBtn) {
            this.cancelPasswordBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.hideModal(this.passwordModal);
            });
        }
        
        // 备忘录事件
        if (this.newMemoBtn) {
            console.log('绑定新建备忘录按钮');
            this.newMemoBtn.addEventListener('click', (e) => {
                console.log('点击新建备忘录按钮');
                e.preventDefault();
                e.stopPropagation();
                this.createMemo();
            });
        }
        
        if (this.saveMemoBtn) {
            this.saveMemoBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.saveMemo();
            });
        }
        
        if (this.closeEditorBtn) {
            this.closeEditorBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.closeEditor();
            });
        }
        
        if (this.deleteMemoBtn) {
            this.deleteMemoBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.promptDeleteMemo();
            });
        }
        
        if (this.exportMemoBtn) {
            this.exportMemoBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.exportCurrentMemo();
            });
        }
        
        if (this.exportAllBtn) {
            this.exportAllBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.exportAllData();
            });
        }
        
        // 分享按钮事件
        if (this.shareConfigBtn) {
            console.log('绑定分享配置按钮');
            this.shareConfigBtn.addEventListener('click', (e) => {
                console.log('点击分享配置按钮');
                e.preventDefault();
                e.stopPropagation();
                this.showShareConfigModal();
            });
        }
        
        // 删除确认事件
        if (this.confirmDeleteBtn) {
            this.confirmDeleteBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.executeDelete();
            });
        }
        
        if (this.cancelDeleteBtn) {
            this.cancelDeleteBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.hideModal(this.confirmModal);
            });
        }
        
        // 编辑器输入事件 - 添加自动保存
        if (this.memoContent) {
            this.memoContent.addEventListener('input', () => {
                this.updateEditorInfo();
                this.scheduleAutoSave();
            });
        }
        
        if (this.memoTitle) {
            this.memoTitle.addEventListener('input', () => {
                this.updateEditorInfo();
                this.scheduleAutoSave();
            });
        }
        
        console.log('事件绑定完成');
    }
    
    async loadData() {
        console.log('加载数据...');
        try {
            // 从GitHub加载数据
            const remoteData = await this.fetchFromGitHub();
            
            if (remoteData && remoteData.data) {
                // 合并远程数据和本地数据
                await this.mergeData(remoteData.data);
                
                // 更新本地缓存
                this.saveLocalData();
                
                this.renderFolders();
                this.updateLastSync();
                
                // 记录远程数据的hash
                this.lastRemoteHash = this.calculateDataHash(this.folders, this.memos);
                
                console.log('数据加载完成，当前版本:', remoteData.version);
            } else {
                // 如果没有远程数据，加载本地数据
                const localData = this.loadLocalData();
                if (localData && localData.data) {
                    this.folders = localData.data.folders || [];
                    this.memos = localData.data.memos || [];
                    this.folderPasswords = new Map(localData.data.passwords || []);
                } else {
                    // 如果没有数据，初始化空数组
                    this.folders = [];
                    this.memos = [];
                    this.folderPasswords = new Map();
                }
                
                this.renderFolders();
                
                // 如果是GitHub存储，尝试上传初始化数据
                if (this.config.storageType === 'github' && this.config.token) {
                    this.scheduleSync();
                }
            }
            
            console.log('数据加载完成');
        } catch (error) {
            console.log('从GitHub加载数据失败，使用本地数据:', error);
            this.loadLocalData();
        }
    }
    
    // 合并数据：处理多设备同步冲突
    async mergeData(remoteData) {
        const localData = this.loadLocalData();
        
        if (!localData || !localData.data) {
            // 没有本地数据，直接使用远程数据
            this.folders = remoteData.folders || [];
            this.memos = remoteData.memos || [];
            this.folderPasswords = new Map(remoteData.passwords || []);
            return;
        }
        
        const localFolders = localData.data.folders || [];
        const localMemos = localData.data.memos || [];
        
        // 合并文件夹（基于ID合并，保留最新的）
        const folderMap = new Map();
        
        // 先添加远程文件夹
        (remoteData.folders || []).forEach(folder => {
            folderMap.set(folder.id, {
                ...folder,
                source: 'remote',
                timestamp: new Date(folder.updatedAt || folder.createdAt || '0').getTime()
            });
        });
        
        // 合并本地文件夹（如果本地有更新版本，保留本地）
        localFolders.forEach(folder => {
            const localTimestamp = new Date(folder.updatedAt || folder.createdAt || '0').getTime();
            const existing = folderMap.get(folder.id);
            
            if (!existing || localTimestamp > existing.timestamp) {
                folderMap.set(folder.id, {
                    ...folder,
                    source: 'local',
                    timestamp: localTimestamp
                });
            }
        });
        
        // 合并备忘录（同样基于ID和更新时间）
        const memoMap = new Map();
        
        // 先添加远程备忘录
        (remoteData.memos || []).forEach(memo => {
            memoMap.set(memo.id, {
                ...memo,
                source: 'remote',
                timestamp: new Date(memo.updatedAt || memo.createdAt || '0').getTime()
            });
        });
        
        // 合并本地备忘录
        localMemos.forEach(memo => {
            const localTimestamp = new Date(memo.updatedAt || memo.createdAt || '0').getTime();
            const existing = memoMap.get(memo.id);
            
            if (!existing || localTimestamp > existing.timestamp) {
                memoMap.set(memo.id, {
                    ...memo,
                    source: 'local',
                    timestamp: localTimestamp
                });
            }
        });
        
        // 转换为数组并过滤掉已删除文件夹中的备忘录
        const mergedFolders = Array.from(folderMap.values()).map(f => ({
            id: f.id,
            name: f.name,
            visibility: f.visibility,
            createdAt: f.createdAt,
            updatedAt: new Date(f.timestamp).toISOString()
        }));
        
        const mergedMemos = Array.from(memoMap.values())
            .filter(memo => mergedFolders.some(f => f.id === memo.folderId))
            .map(m => ({
                id: m.id,
                folderId: m.folderId,
                title: m.title,
                content: m.content,
                createdAt: m.createdAt,
                updatedAt: new Date(m.timestamp).toISOString()
            }));
        
        // 合并密码
        const remotePasswords = new Map(remoteData.passwords || []);
        const localPasswords = new Map(localData.data.passwords || []);
        const mergedPasswords = new Map([...remotePasswords, ...localPasswords]);
        
        this.folders = mergedFolders;
        this.memos = mergedMemos;
        this.folderPasswords = mergedPasswords;
        
        // 记录合并结果
        console.log('数据合并完成:', {
            folders: mergedFolders.length,
            memos: mergedMemos.length,
            passwords: mergedPasswords.size
        });
    }
    
    async fetchFromGitHub() {
        // 如果不是GitHub存储模式，返回null
        if (this.config.storageType !== 'github') {
            return null;
        }
        
        const { username, repo } = this.config;
        if (!username || !repo) return null;
        
        // 使用随机数避免缓存
        const random = Math.random().toString(36).substring(2);
        const url = `https://raw.githubusercontent.com/${username}/${repo}/main/data.json?nocache=${random}`;
        
        try {
            const response = await fetch(url, {
                headers: {
                    'Cache-Control': 'no-cache, no-store, must-revalidate',
                    'Pragma': 'no-cache',
                    'Expires': '0'
                }
            });
            
            if (response.ok) {
                const data = await response.json();
                return {
                    data: data,
                    version: data.version || 0,
                    timestamp: Date.now()
                };
            } else if (response.status === 404) {
                // 文件不存在，返回null
                return null;
            }
        } catch (error) {
            console.error('从GitHub加载数据失败:', error);
        }
        
        return null;
    }
    
    loadLocalData() {
        const localData = localStorage.getItem('memoLocalData');
        if (localData) {
            try {
                return JSON.parse(localData);
            } catch (e) {
                console.error('本地数据解析失败:', e);
            }
        }
        return null;
    }
    
    saveLocalData() {
        const data = {
            data: {
                folders: this.folders,
                memos: this.memos,
                passwords: Array.from(this.folderPasswords.entries())
            },
            version: this.dataVersion,
            lastUpdated: new Date().toISOString(),
            hash: this.calculateDataHash(this.folders, this.memos)
        };
        
        localStorage.setItem('memoLocalData', JSON.stringify(data));
    }
    
    // 计算数据hash，用于检测变更
    calculateDataHash(folders, memos) {
        const dataStr = JSON.stringify({
            folders: folders.sort((a, b) => a.id.localeCompare(b.id)),
            memos: memos.sort((a, b) => a.id.localeCompare(b.id))
        });
        
        // 简单hash计算
        let hash = 0;
        for (let i = 0; i < dataStr.length; i++) {
            const char = dataStr.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // 转换为32位整数
        }
        return hash.toString(16);
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
                e.preventDefault();
                e.stopPropagation();
                this.promptDeleteFolder(folder.id);
            });
            
            folderEl.appendChild(deleteBtn);
            
            folderEl.addEventListener('click', (e) => {
                e.preventDefault();
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
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        
        this.folders.push(folder);
        
        if (visibilityValue === 'private' && password) {
            this.folderPasswords.set(folder.id, btoa(password));
        }
        
        this.renderFolders();
        this.scheduleSync(); // 立即同步
        this.hideModal(this.newFolderModal);
        
        alert('文件夹创建成功！正在同步到云端...');
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
        this.currentMemo = null;
        
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
        
        // 确保新建备忘录按钮可用
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
        this.currentMemo = null;
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
                e.preventDefault();
                e.stopPropagation();
                this.promptDeleteMemo(memo.id);
            });
            
            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'memo-actions';
            actionsDiv.appendChild(deleteBtn);
            memoEl.appendChild(actionsDiv);
            
            memoEl.addEventListener('click', (e) => {
                e.preventDefault();
                this.editMemo(memo.id);
            });
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
        this.currentMemo = null;
        this.showMemoList();
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
        
        this.scheduleSync(); // 立即同步
        this.closeEditor();
        
        alert('备忘录保存成功！正在同步到云端...');
    }
    
    // 自动保存
    scheduleAutoSave() {
        if (!this.currentMemo) return;
        
        this.hasUnsavedChanges = true;
        
        // 清除之前的定时器
        if (this.autoSaveTimer) {
            clearTimeout(this.autoSaveTimer);
        }
        
        // 设置新的定时器
        this.autoSaveTimer = setTimeout(() => {
            if (this.hasUnsavedChanges) {
                this.autoSave();
            }
        }, this.autoSaveDelay);
    }
    
    autoSave() {
        if (!this.currentMemo || !this.hasUnsavedChanges) return;
        
        console.log('自动保存备忘录...');
        
        // 如果是新备忘录，添加到列表
        const existingIndex = this.memos.findIndex(m => m.id === this.currentMemo.id);
        if (existingIndex === -1) {
            this.memos.unshift(this.currentMemo);
        } else {
            this.memos[existingIndex] = this.currentMemo;
        }
        
        // 立即同步
        this.scheduleSync();
        
        this.hasUnsavedChanges = false;
        console.log('自动保存完成');
    }
    
    // 调度同步
    scheduleSync() {
        if (this.syncing) {
            // 如果正在同步，稍后重试
            setTimeout(() => this.scheduleSync(), 1000);
            return;
        }
        
        // 立即执行同步
        this.syncWithGitHub();
    }
    
    async syncWithGitHub() {
        if (this.syncing) {
            console.log('同步进行中，跳过本次请求');
            return;
        }
        
        if (this.config.storageType !== 'github' || !this.config.token) {
            console.log('非GitHub存储模式，跳过同步');
            return;
        }
        
        this.syncing = true;
        
        try {
            console.log('开始同步到GitHub...');
            
            // 保存到本地
            this.saveLocalData();
            
            // 上传到GitHub
            await this.pushToGitHub();
            
            this.updateLastSync();
            console.log('同步完成');
        } catch (error) {
            console.error('同步失败:', error);
            // 将变更加入队列，稍后重试
            this.localChanges.push({
                folders: this.folders,
                memos: this.memos,
                passwords: Array.from(this.folderPasswords.entries()),
                timestamp: Date.now()
            });
        } finally {
            this.syncing = false;
        }
    }
    
    async pushToGitHub() {
        if (this.config.storageType !== 'github' || !this.config.token) {
            return;
        }
        
        const { username, repo } = this.config;
        const apiUrl = `https://api.github.com/repos/${username}/${repo}/contents/data.json`;
        
        // 准备数据
        const data = {
            folders: this.folders,
            memos: this.memos,
            passwords: Array.from(this.folderPasswords.entries()),
            lastUpdated: new Date().toISOString(),
            version: Date.now(),
            deviceId: this.getDeviceId()
        };
        
        try {
            const content = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2))));
            
            // 先尝试获取文件sha
            let sha = null;
            try {
                const response = await fetch(apiUrl, {
                    headers: { 
                        'Authorization': `token ${this.config.token}`,
                        'Accept': 'application/vnd.github.v3+json',
                        'Cache-Control': 'no-cache'
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
            throw error;
        }
    }
    
    // 获取设备ID（用于区分不同设备）
    getDeviceId() {
        let deviceId = localStorage.getItem('memoDeviceId');
        if (!deviceId) {
            deviceId = 'device_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('memoDeviceId', deviceId);
        }
        return deviceId;
    }
    
    // 启动自动同步
    startAutoSync() {
        if (this.config.storageType !== 'github') return;
        
        // 清除之前的定时器
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
        }
        
        // 每10秒检查一次更新
        this.syncInterval = setInterval(() => {
            this.checkForUpdates();
        }, 10000); // 10秒
        
        // 每60秒强制同步一次
        this.syncInterval = setInterval(() => {
            this.forceSync();
        }, 60000); // 60秒
    }
    
    // 检查更新
    async checkForUpdates() {
        try {
            if (this.syncing) {
                return; // 避免重复检查
            }
            
            const currentHash = this.calculateDataHash(this.folders, this.memos);
            
            // 检查远程数据是否更新
            const remoteData = await this.fetchFromGitHub();
            if (remoteData && remoteData.data) {
                const remoteHash = this.calculateDataHash(remoteData.data.folders, remoteData.data.memos);
                
                if (remoteHash !== currentHash && remoteHash !== this.lastRemoteHash) {
                    console.log('检测到远程数据更新，开始合并...');
                    await this.mergeData(remoteData.data);
                    
                    // 更新本地缓存
                    this.saveLocalData();
                    
                    // 重新渲染
                    this.renderFolders();
                    if (this.currentFolder) {
                        this.renderMemos();
                    }
                    
                    // 更新远程hash
                    this.lastRemoteHash = remoteHash;
                    
                    // 显示更新提示
                    this.showNotification('数据已从云端更新');
                }
            }
        } catch (error) {
            console.log('检查更新失败:', error);
        }
    }
    
    // 强制同步
    async forceSync() {
        if (this.syncing) {
            return;
        }
        
        console.log('强制同步...');
        await this.syncWithGitHub();
    }
    
    // 显示通知
    showNotification(message) {
        // 创建通知元素
        const notification = document.createElement('div');
        notification.className = 'sync-notification';
        notification.innerHTML = `
            <i class="fas fa-sync-alt"></i>
            <span>${message}</span>
        `;
        
        // 添加到页面
        document.body.appendChild(notification);
        
        // 显示通知
        setTimeout(() => {
            notification.classList.add('show');
        }, 100);
        
        // 3秒后隐藏并移除
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => {
                if (notification.parentNode) {
                    notification.parentNode.removeChild(notification);
                }
            }, 300);
        }, 3000);
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
        
        if (this.confirmMessage) {
            this.confirmMessage.textContent = message;
        }
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
        
        if (this.confirmMessage) {
            this.confirmMessage.textContent = `确定要删除备忘录"${memo.title}"吗？`;
        }
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
        
        // 立即同步
        this.scheduleSync();
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
            if (this.currentFolderName) {
                this.currentFolderName.textContent = '请选择文件夹';
            }
            if (this.newMemoBtn) {
                this.newMemoBtn.disabled = true;
            }
            if (this.deleteFolderBtn) {
                this.deleteFolderBtn.disabled = true;
            }
            this.showMemoList();
            if (this.memoGrid) {
                this.memoGrid.innerHTML = `
                    <div class="empty-state">
                        <i class="fas fa-sticky-note"></i>
                        <h3>请选择文件夹</h3>
                        <p>选择一个文件夹开始记录</p>
                    </div>
                `;
            }
        }
        
        this.renderFolders();
        
        alert('文件夹删除成功！正在同步到云端...');
    }
    
    deleteMemo(memoId) {
        // 删除备忘录
        this.memos = this.memos.filter(m => m.id !== memoId);
        
        // 如果删除的是当前备忘录，关闭编辑器
        if (this.currentMemo?.id === memoId) {
            this.closeEditor();
        }
        
        this.renderMemos();
        
        alert('备忘录删除成功！正在同步到云端...');
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
        if (this.lastSync) {
            this.lastSync.textContent = new Date().toLocaleString('zh-CN');
        }
    }
    
    showModal(modal) {
        if (!this.modalOverlay || !modal) return;
        
        this.modalOverlay.classList.remove('hidden');
        modal.classList.remove('hidden');
    }
    
    hideModal(modal) {
        if (!this.modalOverlay || !modal) return;
        
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
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM已加载，初始化应用...');
    window.app = new GitHubMemo();
    window.app.init();
});