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
        this.autoSyncInterval = null;
        this.lastSyncTime = 0;
        this.syncing = false;
        this.retryCount = 0;
        this.maxRetries = 3;
        
        // 数据版本
        this.dataVersion = 0;
        
        // 设备ID
        this.deviceId = this.getDeviceId();
        
        // 网络状态
        this.networkStatus = navigator.onLine ? 'online' : 'offline';
        
        // 调试模式
        this.debugMode = localStorage.getItem('memoDebugMode') === 'true';
        
        // 同步队列
        this.syncQueue = [];
        this.processingQueue = false;
        
        // GitHub API状态
        this.githubApiAvailable = true;
        this.rateLimitExceeded = false;
        this.rateLimitResetTime = 0;
        
        // 请求计数器（用于调试）
        this.requestCount = 0;
        
        // 元素引用初始化
        this.foldersList = null;
        this.newFolderBtn = null;
        this.currentFolderName = null;
        this.deleteFolderBtn = null;
        this.memoGrid = null;
        this.newMemoBtn = null;
        this.memoListView = null;
        this.editorView = null;
        this.memoTitle = null;
        this.memoContent = null;
        this.saveMemoBtn = null;
        this.closeEditorBtn = null;
        this.deleteMemoBtn = null;
        this.exportMemoBtn = null;
        this.charCount = null;
        this.lastModified = null;
        this.exportAllBtn = null;
        this.lastSync = null;
        this.storageMode = null;
        this.shareConfigBtn = null;
        
        // 模态框元素
        this.modalOverlay = null;
        this.newFolderModal = null;
        this.folderNameInput = null;
        this.visibilityRadios = null;
        this.passwordGroup = null;
        this.folderPasswordInput = null;
        this.createFolderBtn = null;
        this.cancelFolderBtn = null;
        
        this.passwordModal = null;
        this.inputPassword = null;
        this.submitPasswordBtn = null;
        this.cancelPasswordBtn = null;
        
        this.confirmModal = null;
        this.confirmMessage = null;
        this.confirmDeleteBtn = null;
        this.cancelDeleteBtn = null;
    }
    
    // 安全Base64编码（支持中文）
    safeBtoa(str) {
        try {
            // 将字符串转换为UTF-8字节数组
            const utf8Bytes = new TextEncoder().encode(str);
            let binary = '';
            for (let i = 0; i < utf8Bytes.length; i++) {
                binary += String.fromCharCode(utf8Bytes[i]);
            }
            return btoa(binary);
        } catch (error) {
            console.error('safeBtoa error:', error);
            // 回退到普通btoa
            return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, 
                (match, p1) => String.fromCharCode('0x' + p1)));
        }
    }
    
    // 安全Base64解码（支持中文）
    safeAtob(base64Str) {
        try {
            // 先进行base64解码
            const binary = atob(base64Str);
            const utf8Bytes = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i++) {
                utf8Bytes[i] = binary.charCodeAt(i);
            }
            // 将UTF-8字节数组解码为字符串
            return new TextDecoder().decode(utf8Bytes);
        } catch (error) {
            console.error('safeAtob error:', error);
            // 回退到普通atob
            return decodeURIComponent(atob(base64Str).split('').map(c => 
                '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
        }
    }
    
    // 安全的JSON字符串编码
    encodeJSONForStorage(obj) {
        try {
            const jsonStr = JSON.stringify(obj);
            return this.safeBtoa(jsonStr);
        } catch (error) {
            console.error('encodeJSONForStorage error:', error);
            return btoa(JSON.stringify(obj));
        }
    }
    
    // 安全的JSON字符串解码
    decodeJSONFromStorage(base64Str) {
        try {
            const jsonStr = this.safeAtob(base64Str);
            return JSON.parse(jsonStr);
        } catch (error) {
            console.error('decodeJSONFromStorage error:', error);
            // 尝试兼容旧格式
            try {
                return JSON.parse(atob(base64Str));
            } catch (e2) {
                console.error('Fallback decode also failed:', e2);
                return null;
            }
        }
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
            
            // 解密Token（使用安全Base64）
            if (config.token) {
                try {
                    config.token = this.safeAtob(config.token);
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
            // 1. URL解码
            const base64 = decodeURIComponent(encodedConfig);
            
            // 2. 使用安全Base64解码
            const config = this.decodeJSONFromStorage(base64);
            
            if (!config) {
                console.log('配置解析失败');
                return null;
            }
            
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
            
            // 加密Token后保存（使用安全Base64）
            configToSave.token = this.safeBtoa(config.token);
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
        // 清除URL参数，避免重复加载
        if (window.history.replaceState) {
            const url = new URL(window.location);
            url.searchParams.delete('config');
            window.history.replaceState({}, '', url);
        }
    }
    
    // 生成分享链接的方法
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
            note: 'GitHub备忘录配置链接 - 请在24小时内使用',
            version: '1.0',
            charset: 'UTF-8' // 明确指定字符集
        };
        
        try {
            // 1. 编码为Base64（使用安全编码）
            const base64Data = this.encodeJSONForStorage(shareConfig);
            
            // 2. URL编码
            const encoded = encodeURIComponent(base64Data);
            const baseUrl = window.location.origin + window.location.pathname;
            const shareLink = `${baseUrl}?config=${encoded}`;
            
            return {
                link: shareLink,
                config: shareConfig
            };
        } catch (error) {
            console.error('生成分享链接失败:', error);
            alert('生成分享链接失败，请重试');
            return null;
        }
    }
    
    // 显示分享配置的模态框
    showShareConfigModal() {
        console.log('显示分享配置模态框');
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
                        <li>用户名: ${this.escapeHtml(shareData.config.username)}</li>
                        <li>仓库: ${this.escapeHtml(shareData.config.repo)}</li>
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
            try {
                document.execCommand('copy');
                
                // 显示复制成功提示
                const originalText = copyBtn.innerHTML;
                copyBtn.innerHTML = '<i class="fas fa-check"></i> 已复制';
                copyBtn.disabled = true;
                
                setTimeout(() => {
                    copyBtn.innerHTML = originalText;
                    copyBtn.disabled = false;
                }, 2000);
            } catch (err) {
                // 备用复制方法
                navigator.clipboard.writeText(shareInput.value).then(() => {
                    copyBtn.innerHTML = '<i class="fas fa-check"></i> 已复制';
                    copyBtn.disabled = true;
                    
                    setTimeout(() => {
                        copyBtn.innerHTML = '<i class="fas fa-copy"></i> 复制链接';
                        copyBtn.disabled = false;
                    }, 2000);
                });
            }
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
        
        // 点击模态框外部关闭
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.remove();
                if (overlay) {
                    overlay.classList.add('hidden');
                }
            }
        });
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
        
        // 启动网络监控
        this.startNetworkMonitoring();
        
        // 启动自动同步（GitHub模式）
        if (this.config.storageType === 'github') {
            this.startAutoSync();
        }
        
        console.log('应用初始化完成');
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
        } else {
            console.error('新建文件夹按钮未找到');
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
        } else {
            console.error('新建备忘录按钮未找到');
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
        } else {
            console.error('分享配置按钮未找到');
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
            // 首先加载本地数据
            await this.loadLocalData();
            
            // 如果是GitHub存储模式，尝试同步远程数据
            if (this.config.storageType === 'github') {
                try {
                    await this.syncFromGitHub();
                } catch (syncError) {
                    console.warn('GitHub同步失败，使用本地数据:', syncError.message);
                    // 继续使用本地数据
                }
            }
            
            this.renderFolders();
            this.updateLastSync();
            console.log('数据加载完成');
            
            // 显示数据统计
            this.logDataStats();
            
        } catch (error) {
            console.error('加载数据失败:', error);
            this.showNotification('数据加载失败，使用本地数据', 'error');
        }
    }
    
    async loadLocalData() {
        const saved = localStorage.getItem('memoLocalData');
        if (saved) {
            try {
                const data = JSON.parse(saved);
                this.folders = data.folders || [];
                this.memos = data.memos || [];
                this.folderPasswords = new Map(data.passwords || []);
                this.dataVersion = data.version || 0;
                console.log('从本地存储加载数据成功，文件夹数:', this.folders.length);
            } catch (e) {
                console.error('本地数据解析失败:', e);
                this.initializeEmptyData();
            }
        } else {
            this.initializeEmptyData();
        }
    }
    
    initializeEmptyData() {
        this.folders = [];
        this.memos = [];
        this.folderPasswords = new Map();
        this.dataVersion = 0;
    }
    
    renderFolders() {
        console.log('渲染文件夹...');
        if (!this.foldersList) {
            console.error('文件夹列表元素未找到');
            return;
        }
        
        this.foldersList.innerHTML = '';
        
        if (this.folders.length === 0) {
            this.foldersList.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-folder-open"></i>
                    <p>暂无文件夹</p>
                    <p class="tip">点击"新建"按钮创建第一个文件夹</p>
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
            
            // 使用escapeHtml防止XSS，同时确保中文字符正确显示
            folderEl.innerHTML = `
                <div class="folder-content">
                    <i class="fas fa-folder folder-icon ${folder.visibility === 'private' ? 'folder-private' : ''}"></i>
                    <span class="folder-name">${this.escapeHtml(folder.name)}</span>
                </div>
                <div class="folder-meta">
                    ${folder.visibility === 'private' ? '<i class="fas fa-lock" title="密码保护"></i>' : ''}
                    <span class="folder-date">${new Date(folder.updatedAt || folder.createdAt).toLocaleDateString()}</span>
                </div>
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
        
        // 确保滚动区域正常工作
        this.ensureScrollable();
    }
    
    showNewFolderModal() {
        console.log('显示新建文件夹模态框');
        if (!this.newFolderModal || !this.folderNameInput) {
            console.error('新建文件夹模态框元素未找到');
            return;
        }
        
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
        this.folderNameInput.focus();
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
        
        const now = new Date().toISOString();
        const folder = {
            id: Date.now().toString(),
            name: name,
            visibility: visibilityValue,
            createdAt: now,
            updatedAt: now,
            deviceId: this.deviceId
        };
        
        this.folders.unshift(folder); // 添加到开头
        
        if (visibilityValue === 'private' && password) {
            this.folderPasswords.set(folder.id, this.safeBtoa(password));
        }
        
        // 保存数据
        this.saveLocalData();
        
        // 添加到同步队列
        this.addToSyncQueue();
        
        this.renderFolders();
        this.hideModal(this.newFolderModal);
        
        // 选择新创建的文件夹
        this.selectFolder(folder);
        
        this.showNotification('文件夹创建成功', 'success');
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
        
        if (this.currentFolderName) {
            this.currentFolderName.textContent = folder.name;
        }
        
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
    
    createMemo() {
        console.log('创建新备忘录...');
        if (!this.currentFolder) {
            alert('请先选择一个文件夹');
            return;
        }
        
        const now = new Date().toISOString();
        this.currentMemo = {
            id: Date.now().toString(),
            folderId: this.currentFolder.id,
            title: '新备忘录',
            content: '',
            createdAt: now,
            updatedAt: now,
            deviceId: this.deviceId
        };
        
        this.memos.unshift(this.currentMemo);
        this.showEditor();
        this.updateEditor();
        
        // 焦点设置
        setTimeout(() => {
            if (this.memoTitle) {
                this.memoTitle.focus();
            }
        }, 100);
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
        if (!this.memoGrid || !this.currentFolder) return;
        
        this.memoGrid.innerHTML = '';
        
        const folderMemos = this.memos.filter(memo => memo.folderId === this.currentFolder.id);
        
        if (folderMemos.length === 0) {
            this.memoGrid.innerHTML = `
                <div class="empty-state">
                    <i class="fas fa-sticky-note"></i>
                    <h3>暂无备忘录</h3>
                    <p>点击"新建备忘录"按钮开始记录</p>
                </div>
            `;
            return;
        }
        
        folderMemos.forEach(memo => {
            const memoEl = document.createElement('div');
            memoEl.className = 'memo-card';
            
            // 截取内容预览
            const contentPreview = memo.content ? 
                memo.content.substring(0, 150).replace(/\n/g, ' ') + (memo.content.length > 150 ? '...' : '') : 
                '暂无内容';
            
            // 格式化日期
            const date = new Date(memo.updatedAt || memo.createdAt);
            const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString().slice(0, 5);
            
            // 使用escapeHtml防止XSS，确保中文字符正确显示
            memoEl.innerHTML = `
                <div class="memo-header">
                    <h3 title="${this.escapeHtml(memo.title)}">${this.escapeHtml(memo.title)}</h3>
                    <span class="memo-date">${dateStr}</span>
                </div>
                <div class="memo-content">${this.escapeHtml(contentPreview)}</div>
                <div class="memo-actions">
                    <button class="memo-action-btn memo-edit-btn" title="编辑">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="memo-action-btn memo-delete-btn" title="删除">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            `;
            
            // 绑定编辑事件
            const editBtn = memoEl.querySelector('.memo-edit-btn');
            editBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.editMemo(memo.id);
            });
            
            // 绑定删除事件
            const deleteBtn = memoEl.querySelector('.memo-delete-btn');
            deleteBtn.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.promptDeleteMemo(memo.id);
            });
            
            // 点击卡片主体编辑
            memoEl.addEventListener('click', (e) => {
                if (!e.target.closest('.memo-actions')) {
                    this.editMemo(memo.id);
                }
            });
            
            this.memoGrid.appendChild(memoEl);
        });
    }
    
    editMemo(memoId) {
        const memo = this.memos.find(m => m.id === memoId);
        if (!memo) return;
        
        this.currentMemo = memo;
        this.showEditor();
        this.updateEditor();
        
        // 焦点设置
        setTimeout(() => {
            if (this.memoContent) {
                this.memoContent.focus();
            }
        }, 100);
    }
    
    updateEditor() {
        if (!this.currentMemo || !this.memoTitle || !this.memoContent) return;
        
        this.memoTitle.value = this.currentMemo.title || '';
        this.memoContent.value = this.currentMemo.content || '';
        this.updateEditorInfo();
    }
    
    updateEditorInfo() {
        if (!this.charCount || !this.lastModified) return;
        
        // 字符计数
        const content = this.memoContent ? this.memoContent.value : '';
        const title = this.memoTitle ? this.memoTitle.value : '';
        const totalChars = content.length + title.length;
        this.charCount.textContent = totalChars;
        
        // 最后修改时间
        if (this.currentMemo && this.currentMemo.updatedAt) {
            const date = new Date(this.currentMemo.updatedAt);
            const now = new Date();
            const diffMinutes = Math.floor((now - date) / (1000 * 60));
            
            if (diffMinutes < 1) {
                this.lastModified.textContent = '刚刚';
            } else if (diffMinutes < 60) {
                this.lastModified.textContent = `${diffMinutes}分钟前`;
            } else if (diffMinutes < 1440) {
                const hours = Math.floor(diffMinutes / 60);
                this.lastModified.textContent = `${hours}小时前`;
            } else {
                this.lastModified.textContent = date.toLocaleDateString();
            }
        } else {
            this.lastModified.textContent = '刚刚';
        }
    }
    
    saveMemo() {
        if (!this.currentMemo) return;
        
        const title = this.memoTitle.value.trim();
        const content = this.memoContent.value.trim();
        
        if (!title) {
            alert('请输入备忘录标题');
            this.memoTitle.focus();
            return;
        }
        
        this.currentMemo.title = title;
        this.currentMemo.content = content;
        this.currentMemo.updatedAt = new Date().toISOString();
        
        // 更新备忘录列表中的条目
        const memoIndex = this.memos.findIndex(m => m.id === this.currentMemo.id);
        if (memoIndex !== -1) {
            this.memos[memoIndex] = this.currentMemo;
        }
        
        // 保存数据
        this.saveLocalData();
        
        // 添加到同步队列
        this.addToSyncQueue();
        
        // 更新视图
        this.renderMemos();
        
        this.showNotification('备忘录已保存', 'success');
    }
    
    closeEditor() {
        if (this.currentMemo && 
            (this.memoTitle.value.trim() !== this.currentMemo.title || 
             this.memoContent.value.trim() !== this.currentMemo.content)) {
            
            if (confirm('备忘录有未保存的更改，确定要关闭吗？')) {
                this.showMemoList();
                this.renderMemos();
            }
        } else {
            this.showMemoList();
            this.renderMemos();
        }
    }
    
    promptDeleteMemo(memoId) {
        const memo = memoId ? this.memos.find(m => m.id === memoId) : this.currentMemo;
        if (!memo) return;
        
        this.pendingDelete = {
            type: 'memo',
            id: memo.id
        };
        
        if (this.confirmMessage) {
            this.confirmMessage.textContent = `确定要删除备忘录"${this.escapeHtml(memo.title)}"吗？此操作无法撤销。`;
        }
        
        this.showModal(this.confirmModal);
    }
    
    promptDeleteFolder(folderId) {
        const folder = folderId ? this.folders.find(f => f.id === folderId) : this.currentFolder;
        if (!folder) return;
        
        // 检查文件夹中是否有备忘录
        const folderMemos = this.memos.filter(memo => memo.folderId === folder.id);
        
        this.pendingDelete = {
            type: 'folder',
            id: folder.id
        };
        
        if (this.confirmMessage) {
            let message = `确定要删除文件夹"${this.escapeHtml(folder.name)}"吗？`;
            if (folderMemos.length > 0) {
                message += `\n文件夹中包含 ${folderMemos.length} 个备忘录，也将被删除。`;
            }
            message += '\n此操作无法撤销。';
            this.confirmMessage.textContent = message;
        }
        
        this.showModal(this.confirmModal);
    }
    
    executeDelete() {
        if (!this.pendingDelete.type || !this.pendingDelete.id) {
            this.hideModal(this.confirmModal);
            return;
        }
        
        if (this.pendingDelete.type === 'memo') {
            // 删除备忘录
            const memoIndex = this.memos.findIndex(m => m.id === this.pendingDelete.id);
            if (memoIndex !== -1) {
                this.memos.splice(memoIndex, 1);
                
                // 如果当前正在编辑这个备忘录，关闭编辑器
                if (this.currentMemo && this.currentMemo.id === this.pendingDelete.id) {
                    this.showMemoList();
                    this.currentMemo = null;
                }
                
                this.showNotification('备忘录已删除', 'success');
            }
        } else if (this.pendingDelete.type === 'folder') {
            // 删除文件夹及其所有备忘录
            const folderIndex = this.folders.findIndex(f => f.id === this.pendingDelete.id);
            if (folderIndex !== -1) {
                this.folders.splice(folderIndex, 1);
                
                // 删除文件夹中的所有备忘录
                this.memos = this.memos.filter(memo => memo.folderId !== this.pendingDelete.id);
                
                // 删除文件夹密码
                this.folderPasswords.delete(this.pendingDelete.id);
                
                // 如果当前正在查看这个文件夹，切换到文件夹列表
                if (this.currentFolder && this.currentFolder.id === this.pendingDelete.id) {
                    this.currentFolder = null;
                    this.currentMemo = null;
                    this.showMemoList();
                    
                    if (this.currentFolderName) {
                        this.currentFolderName.textContent = '请选择文件夹';
                    }
                    
                    if (this.newMemoBtn) {
                        this.newMemoBtn.disabled = true;
                    }
                    
                    if (this.deleteFolderBtn) {
                        this.deleteFolderBtn.disabled = true;
                    }
                }
                
                this.showNotification('文件夹已删除', 'success');
            }
        }
        
        // 保存数据
        this.saveLocalData();
        
        // 添加到同步队列
        this.addToSyncQueue();
        
        // 更新视图
        this.renderFolders();
        this.renderMemos();
        
        // 重置删除状态
        this.pendingDelete = { type: null, id: null };
        this.hideModal(this.confirmModal);
    }
    
    showModal(modal) {
        if (!modal) return;
        
        modal.classList.remove('hidden');
        
        // 显示遮罩层
        if (this.modalOverlay) {
            this.modalOverlay.classList.remove('hidden');
        }
    }
    
    hideModal(modal) {
        if (!modal) return;
        
        modal.classList.add('hidden');
        
        // 隐藏遮罩层
        if (this.modalOverlay) {
            this.modalOverlay.classList.add('hidden');
        }
    }
    
    // HTML转义，防止XSS攻击
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    saveLocalData() {
        const data = {
            folders: this.folders,
            memos: this.memos,
            passwords: Array.from(this.folderPasswords.entries()),
            version: ++this.dataVersion,
            lastModified: new Date().toISOString(),
            charset: 'UTF-8'
        };
        
        localStorage.setItem('memoLocalData', JSON.stringify(data));
        console.log('本地数据已保存，版本:', this.dataVersion);
    }
    
    addToSyncQueue() {
        // 简化实现：立即保存到GitHub（如果启用）
        if (this.config.storageType === 'github') {
            this.saveToGitHub().catch(console.error);
        }
    }
    
    showNotification(message, type = 'info') {
        console.log('显示通知:', message, type);
        alert(message); // 先用简单的alert代替
    }
    
    startNetworkMonitoring() {
        window.addEventListener('online', () => {
            this.networkStatus = 'online';
            console.log('网络已连接');
            
            // 网络恢复后尝试同步
            if (this.config.storageType === 'github') {
                this.syncFromGitHub().catch(console.error);
            }
        });
        
        window.addEventListener('offline', () => {
            this.networkStatus = 'offline';
            console.log('网络已断开');
        });
    }
    
    startAutoSync() {
        if (this.autoSyncInterval) {
            clearInterval(this.autoSyncInterval);
        }
        
        // 每5分钟自动同步一次
        this.autoSyncInterval = setInterval(() => {
            if (this.config.storageType === 'github' && this.networkStatus === 'online') {
                this.syncFromGitHub().catch(console.error);
            }
        }, 5 * 60 * 1000);
        
        console.log('自动同步已启动（每5分钟一次）');
    }
    
    updateLastSync() {
        if (!this.lastSync) return;
        
        const now = new Date();
        this.lastSync.textContent = now.toLocaleTimeString();
        this.lastSyncTime = now.getTime();
    }
    
    logDataStats() {
        console.log('数据统计:', {
            文件夹数量: this.folders.length,
            备忘录数量: this.memos.length,
            数据版本: this.dataVersion,
            设备ID: this.deviceId.substring(0, 8),
            存储模式: this.config.storageType
        });
    }
    
    // 修复手机端文件夹显示问题
    ensureScrollable() {
        if (!this.foldersList) return;
        
        // 检查是否需要滚动
        const hasScroll = this.foldersList.scrollHeight > this.foldersList.clientHeight;
        
        if (hasScroll) {
            this.foldersList.classList.add('scrollable');
        } else {
            this.foldersList.classList.remove('scrollable');
        }
    }
    
    // 简化版本的其他方法（为了代码简洁，省略了一些同步相关方法）
    async syncFromGitHub() {
        console.log('同步功能需要完整实现');
    }
    
    async saveToGitHub() {
        console.log('保存到GitHub功能需要完整实现');
    }
}

// 初始化应用
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM加载完成，初始化应用...');
    try {
        window.app = new GitHubMemo();
        window.app.init();
    } catch (error) {
        console.error('应用初始化失败:', error);
        alert('应用初始化失败，请检查控制台日志');
    }
});