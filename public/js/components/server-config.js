/**
 * Server Config Component
 * Registers itself to window.Components for Alpine.js to consume
 */
window.Components = window.Components || {};

window.Components.serverConfig = () => ({
    serverConfig: {},
    loading: false,
    advancedExpanded: false,
    debounceTimers: {}, // Store debounce timers for each config field

    // Server presets state
    serverPresets: [],
    selectedServerPreset: '',
    loadingPreset: false,
    savingServerPreset: false,
    deletingServerPreset: false,
    newServerPresetName: '',
    newServerPresetDescription: '',
    editingPresetMode: false,
    editingPresetOriginalName: '',
    presetPreviewExpanded: false,

    init() {
        // Initial fetch if this is the active sub-tab
        if (this.activeTab === 'server') {
            this.fetchServerConfig();
            this.fetchServerPresets();
        }

        // Watch local activeTab (from parent settings scope, skip initial trigger)
        this.$watch('activeTab', (tab, oldTab) => {
            if (tab === 'server' && oldTab !== undefined) {
                this.fetchServerConfig();
                this.fetchServerPresets();
            }
        });
    },

    async fetchServerConfig() {
        const password = Alpine.store('global').webuiPassword;
        try {
            const { response, newPassword } = await window.utils.request('/api/config', {}, password);
            if (newPassword) Alpine.store('global').webuiPassword = newPassword;

            if (!response.ok) throw new Error('Failed to fetch config');
            const data = await response.json();
            this.serverConfig = data.config || {};
        } catch (e) {
            console.error('Failed to fetch server config:', e);
        }
    },



    // Password management
    passwordDialog: {
        show: false,
        oldPassword: '',
        newPassword: '',
        confirmPassword: ''
    },

    showPasswordDialog() {
        this.passwordDialog = {
            show: true,
            oldPassword: '',
            newPassword: '',
            confirmPassword: ''
        };
    },

    hidePasswordDialog() {
        this.passwordDialog = {
            show: false,
            oldPassword: '',
            newPassword: '',
            confirmPassword: ''
        };
    },

    async changePassword() {
        const store = Alpine.store('global');
        const { oldPassword, newPassword, confirmPassword } = this.passwordDialog;

        if (newPassword !== confirmPassword) {
            store.showToast(store.t('passwordsNotMatch'), 'error');
            return;
        }
        if (newPassword.length < 6) {
            store.showToast(store.t('passwordTooShort'), 'error');
            return;
        }

        try {
            const { response } = await window.utils.request('/api/config/password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ oldPassword, newPassword })
            }, store.webuiPassword);

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || store.t('failedToChangePassword'));
            }

            // Update stored password
            store.webuiPassword = newPassword;
            store.showToast(store.t('passwordChangedSuccess'), 'success');
            this.hidePasswordDialog();
        } catch (e) {
            store.showToast(store.t('failedToChangePassword') + ': ' + e.message, 'error');
        }
    },

    // Toggle Developer Mode with instant save
    async toggleDevMode(enabled) {
        const store = Alpine.store('global');

        // Optimistic update
        const previousDevMode = this.serverConfig.devMode;
        const previousDebug = this.serverConfig.debug;
        this.serverConfig.devMode = enabled;
        this.serverConfig.debug = enabled;

        try {
            const { response, newPassword } = await window.utils.request('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ devMode: enabled })
            }, store.webuiPassword);

            if (newPassword) store.webuiPassword = newPassword;

            const data = await response.json();
            if (data.status === 'ok') {
                const status = enabled ? store.t('enabledStatus') : store.t('disabledStatus');
                store.showToast(store.t('devModeToggled', { status }), 'success');
                // Update data store
                Alpine.store('data').devMode = enabled;
                await this.fetchServerConfig(); // Confirm server state
            } else {
                throw new Error(data.error || store.t('failedToUpdateDevMode'));
            }
        } catch (e) {
            // Rollback on error
            this.serverConfig.devMode = previousDevMode;
            this.serverConfig.debug = previousDebug;
            store.showToast(store.t('failedToUpdateDevMode') + ': ' + e.message, 'error');
        }
    },

    // Toggle Token Cache with instant save
    async toggleTokenCache(enabled) {
        const store = Alpine.store('global');

        // Optimistic update
        const previousValue = this.serverConfig.persistTokenCache;
        this.serverConfig.persistTokenCache = enabled;

        try {
            const { response, newPassword } = await window.utils.request('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ persistTokenCache: enabled })
            }, store.webuiPassword);

            if (newPassword) store.webuiPassword = newPassword;

            const data = await response.json();
            if (data.status === 'ok') {
                const status = enabled ? store.t('enabledStatus') : store.t('disabledStatus');
                store.showToast(store.t('tokenCacheToggled', { status }), 'success');
                await this.fetchServerConfig(); // Confirm server state
            } else {
                throw new Error(data.error || store.t('failedToUpdateTokenCache'));
            }
        } catch (e) {
            // Rollback on error
            this.serverConfig.persistTokenCache = previousValue;
            store.showToast(store.t('failedToUpdateTokenCache') + ': ' + e.message, 'error');
        }
    },

    // Generic debounced save method for numeric configs with validation
    async saveConfigField(fieldName, value, displayName, validator = null) {
        const store = Alpine.store('global');

        // Validate input if validator provided
        if (validator) {
            const validation = window.Validators.validate(value, validator, true);
            if (!validation.isValid) {
                // Rollback to previous value
                this.serverConfig[fieldName] = this.serverConfig[fieldName];
                return;
            }
            value = validation.value;
        } else {
            value = parseInt(value);
        }

        // Clear existing timer for this field
        if (this.debounceTimers[fieldName]) {
            clearTimeout(this.debounceTimers[fieldName]);
        }

        // Optimistic update
        const previousValue = this.serverConfig[fieldName];
        this.serverConfig[fieldName] = value;

        // Set new timer
        this.debounceTimers[fieldName] = setTimeout(async () => {
            try {
                const payload = {};
                payload[fieldName] = value;

                const { response, newPassword } = await window.utils.request('/api/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                }, store.webuiPassword);

                if (newPassword) store.webuiPassword = newPassword;

                const data = await response.json();
                if (data.status === 'ok') {
                    store.showToast(store.t('fieldUpdated', { displayName, value }), 'success');
                    await this.fetchServerConfig(); // Confirm server state
                } else {
                    throw new Error(data.error || store.t('failedToUpdateField', { displayName }));
                }
            } catch (e) {
                // Rollback on error
                this.serverConfig[fieldName] = previousValue;
                store.showToast(store.t('failedToUpdateField', { displayName }) + ': ' + e.message, 'error');
            }
        }, window.AppConstants.INTERVALS.CONFIG_DEBOUNCE);
    },

    // Individual toggle methods for each Advanced Tuning field with validation
    toggleMaxRetries(value) {
        const { MAX_RETRIES_MIN, MAX_RETRIES_MAX } = window.AppConstants.VALIDATION;
        this.saveConfigField('maxRetries', value, 'Max Retries',
            (v) => window.Validators.validateRange(v, MAX_RETRIES_MIN, MAX_RETRIES_MAX, 'Max Retries'));
    },

    toggleRetryBaseMs(value) {
        const { RETRY_BASE_MS_MIN, RETRY_BASE_MS_MAX } = window.AppConstants.VALIDATION;
        this.saveConfigField('retryBaseMs', value, 'Retry Base Delay',
            (v) => window.Validators.validateRange(v, RETRY_BASE_MS_MIN, RETRY_BASE_MS_MAX, 'Retry Base Delay'));
    },

    toggleRetryMaxMs(value) {
        const { RETRY_MAX_MS_MIN, RETRY_MAX_MS_MAX } = window.AppConstants.VALIDATION;
        this.saveConfigField('retryMaxMs', value, 'Retry Max Delay',
            (v) => window.Validators.validateRange(v, RETRY_MAX_MS_MIN, RETRY_MAX_MS_MAX, 'Retry Max Delay'));
    },

    toggleDefaultCooldownMs(value) {
        const { DEFAULT_COOLDOWN_MIN, DEFAULT_COOLDOWN_MAX } = window.AppConstants.VALIDATION;
        this.saveConfigField('defaultCooldownMs', value, 'Default Cooldown',
            (v) => window.Validators.validateTimeout(v, DEFAULT_COOLDOWN_MIN, DEFAULT_COOLDOWN_MAX));
    },

    toggleMaxWaitBeforeErrorMs(value) {
        const { MAX_WAIT_MIN, MAX_WAIT_MAX } = window.AppConstants.VALIDATION;
        this.saveConfigField('maxWaitBeforeErrorMs', value, 'Max Wait Threshold',
            (v) => window.Validators.validateTimeout(v, MAX_WAIT_MIN, MAX_WAIT_MAX));
    },

    toggleGlobalQuotaThreshold(value) {
        const { GLOBAL_QUOTA_THRESHOLD_MIN, GLOBAL_QUOTA_THRESHOLD_MAX } = window.AppConstants.VALIDATION;
        const store = Alpine.store('global');
        const pct = parseInt(value);
        if (isNaN(pct) || pct < GLOBAL_QUOTA_THRESHOLD_MIN || pct > GLOBAL_QUOTA_THRESHOLD_MAX) return;

        // Store as percentage in UI, convert to fraction for backend
        const fraction = pct / 100;

        if (this.debounceTimers['globalQuotaThreshold']) {
            clearTimeout(this.debounceTimers['globalQuotaThreshold']);
        }

        const previousValue = this.serverConfig.globalQuotaThreshold;
        this.serverConfig.globalQuotaThreshold = fraction;

        this.debounceTimers['globalQuotaThreshold'] = setTimeout(async () => {
            try {
                const { response, newPassword } = await window.utils.request('/api/config', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ globalQuotaThreshold: fraction })
                }, store.webuiPassword);

                if (newPassword) store.webuiPassword = newPassword;

                const data = await response.json();
                if (data.status === 'ok') {
                    store.showToast(store.t('fieldUpdated', { displayName: 'Minimum Quota Level', value: pct + '%' }), 'success');
                    await this.fetchServerConfig();
                } else {
                    throw new Error(data.error || store.t('failedToUpdateField', { displayName: 'Minimum Quota Level' }));
                }
            } catch (e) {
                this.serverConfig.globalQuotaThreshold = previousValue;
                store.showToast(store.t('failedToUpdateField', { displayName: 'Minimum Quota Level' }) + ': ' + e.message, 'error');
            }
        }, window.AppConstants.INTERVALS.CONFIG_DEBOUNCE);
    },

    toggleMaxAccounts(value) {
        const { MAX_ACCOUNTS_MIN, MAX_ACCOUNTS_MAX } = window.AppConstants.VALIDATION;
        this.saveConfigField('maxAccounts', value, 'Max Accounts',
            (v) => window.Validators.validateRange(v, MAX_ACCOUNTS_MIN, MAX_ACCOUNTS_MAX, 'Max Accounts'));
    },

    toggleRateLimitDedupWindowMs(value) {
        const { RATE_LIMIT_DEDUP_MIN, RATE_LIMIT_DEDUP_MAX } = window.AppConstants.VALIDATION;
        this.saveConfigField('rateLimitDedupWindowMs', value, 'Rate Limit Dedup Window',
            (v) => window.Validators.validateTimeout(v, RATE_LIMIT_DEDUP_MIN, RATE_LIMIT_DEDUP_MAX));
    },

    toggleMaxConsecutiveFailures(value) {
        const { MAX_CONSECUTIVE_FAILURES_MIN, MAX_CONSECUTIVE_FAILURES_MAX } = window.AppConstants.VALIDATION;
        this.saveConfigField('maxConsecutiveFailures', value, 'Max Consecutive Failures',
            (v) => window.Validators.validateRange(v, MAX_CONSECUTIVE_FAILURES_MIN, MAX_CONSECUTIVE_FAILURES_MAX, 'Max Consecutive Failures'));
    },

    toggleExtendedCooldownMs(value) {
        const { EXTENDED_COOLDOWN_MIN, EXTENDED_COOLDOWN_MAX } = window.AppConstants.VALIDATION;
        this.saveConfigField('extendedCooldownMs', value, 'Extended Cooldown',
            (v) => window.Validators.validateTimeout(v, EXTENDED_COOLDOWN_MIN, EXTENDED_COOLDOWN_MAX));
    },

    toggleMaxCapacityRetries(value) {
        const { MAX_CAPACITY_RETRIES_MIN, MAX_CAPACITY_RETRIES_MAX } = window.AppConstants.VALIDATION;
        this.saveConfigField('maxCapacityRetries', value, 'Max Capacity Retries',
            (v) => window.Validators.validateRange(v, MAX_CAPACITY_RETRIES_MIN, MAX_CAPACITY_RETRIES_MAX, 'Max Capacity Retries'));
    },

    // Toggle Account Selection Strategy
    async toggleStrategy(strategy) {
        const store = Alpine.store('global');
        const validStrategies = ['sticky', 'round-robin', 'hybrid'];

        if (!validStrategies.includes(strategy)) {
            store.showToast(store.t('invalidStrategy'), 'error');
            return;
        }

        // Optimistic update
        const previousValue = this.serverConfig.accountSelection?.strategy || 'hybrid';
        if (!this.serverConfig.accountSelection) {
            this.serverConfig.accountSelection = {};
        }
        this.serverConfig.accountSelection.strategy = strategy;

        try {
            const { response, newPassword } = await window.utils.request('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accountSelection: { strategy } })
            }, store.webuiPassword);

            if (newPassword) store.webuiPassword = newPassword;

            const data = await response.json();
            if (data.status === 'ok') {
                const strategyLabel = this.getStrategyLabel(strategy);
                store.showToast(store.t('strategyUpdated', { strategy: strategyLabel }), 'success');
                await this.fetchServerConfig(); // Confirm server state
            } else {
                throw new Error(data.error || store.t('failedToUpdateStrategy'));
            }
        } catch (e) {
            // Rollback on error
            if (!this.serverConfig.accountSelection) {
                this.serverConfig.accountSelection = {};
            }
            this.serverConfig.accountSelection.strategy = previousValue;
            store.showToast(store.t('failedToUpdateStrategy') + ': ' + e.message, 'error');
        }
    },

    // Get display label for a strategy
    getStrategyLabel(strategy) {
        const store = Alpine.store('global');
        const labels = {
            'sticky': store.t('strategyStickyLabel'),
            'round-robin': store.t('strategyRoundRobinLabel'),
            'hybrid': store.t('strategyHybridLabel')
        };
        return labels[strategy] || strategy;
    },

    // Get description for current strategy
    currentStrategyDescription() {
        const store = Alpine.store('global');
        const strategy = this.serverConfig.accountSelection?.strategy || 'hybrid';
        const descriptions = {
            'sticky': store.t('strategyStickyDesc'),
            'round-robin': store.t('strategyRoundRobinDesc'),
            'hybrid': store.t('strategyHybridDesc')
        };
        return descriptions[strategy] || '';
    },

    // ==========================================
    // Server Configuration Presets
    // ==========================================

    async fetchServerPresets() {
        const password = Alpine.store('global').webuiPassword;
        try {
            const { response, newPassword } = await window.utils.request('/api/server/presets', {}, password);
            if (newPassword) Alpine.store('global').webuiPassword = newPassword;

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (data.status === 'ok') {
                this.serverPresets = data.presets || [];
                if (this.serverPresets.length > 0 && !this.selectedServerPreset) {
                    this.selectedServerPreset = this.serverPresets[0].name;
                }
            }
        } catch (e) {
            console.error('Failed to fetch server presets:', e);
        }
    },

    /**
     * Load a server preset — applies all config values via POST /api/config
     */
    async loadServerPreset(name) {
        const preset = this.serverPresets.find(p => p.name === name);
        if (!preset) return;

        this.loadingPreset = true;
        const store = Alpine.store('global');

        try {
            const { response, newPassword } = await window.utils.request('/api/config', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(preset.config)
            }, store.webuiPassword);

            if (newPassword) store.webuiPassword = newPassword;

            const data = await response.json();
            if (data.status === 'ok') {
                store.showToast(store.t('serverPresetLoaded', { name }) || `Preset "${name}" applied`, 'success');
                await this.fetchServerConfig();
            } else {
                throw new Error(data.error || 'Failed to apply preset');
            }
        } catch (e) {
            store.showToast((store.t('failedToLoadServerPreset') || 'Failed to apply preset') + ': ' + e.message, 'error');
        } finally {
            this.loadingPreset = false;
        }
    },

    /**
     * Save current server config as a new custom preset
     */
    async saveCurrentAsServerPreset() {
        this.editingPresetMode = false;
        this.editingPresetOriginalName = '';
        this.newServerPresetName = '';
        this.newServerPresetDescription = '';
        document.getElementById('save_server_preset_modal').showModal();
    },

    /**
     * Edit an existing custom preset's name and description
     */
    editServerPreset() {
        const preset = this.serverPresets.find(p => p.name === this.selectedServerPreset);
        if (!preset || preset.builtIn) return;

        this.editingPresetMode = true;
        this.editingPresetOriginalName = preset.name;
        this.newServerPresetName = preset.name;
        this.newServerPresetDescription = preset.description || '';
        document.getElementById('save_server_preset_modal').showModal();
    },

    /**
     * Execute PATCH to update preset metadata
     */
    async executeEditServerPreset() {
        const name = this.newServerPresetName.trim();
        if (!name) {
            Alpine.store('global').showToast(Alpine.store('global').t('presetNameRequired') || 'Preset name is required', 'error');
            return;
        }

        this.savingServerPreset = true;
        const store = Alpine.store('global');

        try {
            const payload = { name, description: this.newServerPresetDescription.trim() || '' };

            const { response, newPassword } = await window.utils.request(
                `/api/server/presets/${encodeURIComponent(this.editingPresetOriginalName)}`,
                {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                },
                store.webuiPassword
            );
            if (newPassword) store.webuiPassword = newPassword;

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || `HTTP ${response.status}`);
            }
            const data = await response.json();
            if (data.status === 'ok') {
                this.serverPresets = data.presets || [];
                this.selectedServerPreset = name;
                this.editingPresetMode = false;
                this.editingPresetOriginalName = '';
                this.newServerPresetName = '';
                this.newServerPresetDescription = '';
                store.showToast(store.t('serverPresetUpdated') || 'Preset updated', 'success');
                document.getElementById('save_server_preset_modal').close();
            } else {
                throw new Error(data.error || 'Failed to update preset');
            }
        } catch (e) {
            store.showToast((store.t('failedToEditServerPreset') || 'Failed to update preset') + ': ' + e.message, 'error');
        } finally {
            this.savingServerPreset = false;
        }
    },

    async executeSaveServerPreset(name) {
        if (!name || !name.trim()) {
            Alpine.store('global').showToast(Alpine.store('global').t('presetNameRequired') || 'Preset name is required', 'error');
            return;
        }

        this.savingServerPreset = true;
        const store = Alpine.store('global');
        const password = store.webuiPassword;

        try {
            // Extract relevant config fields (exclude sensitive/non-tunable)
            const relevantKeys = [
                'maxRetries', 'retryBaseMs', 'retryMaxMs', 'defaultCooldownMs',
                'maxWaitBeforeErrorMs', 'maxAccounts', 'globalQuotaThreshold',
                'rateLimitDedupWindowMs', 'maxConsecutiveFailures', 'extendedCooldownMs',
                'maxCapacityRetries', 'accountSelection'
            ];
            const presetConfig = {};
            relevantKeys.forEach(k => {
                if (this.serverConfig[k] !== undefined) {
                    presetConfig[k] = JSON.parse(JSON.stringify(this.serverConfig[k]));
                }
            });

            const payload = { name: name.trim(), config: presetConfig };
            if (this.newServerPresetDescription.trim()) {
                payload.description = this.newServerPresetDescription.trim();
            }

            const { response, newPassword } = await window.utils.request('/api/server/presets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }, password);
            if (newPassword) store.webuiPassword = newPassword;

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || `HTTP ${response.status}`);
            }
            const data = await response.json();
            if (data.status === 'ok') {
                this.serverPresets = data.presets || [];
                this.selectedServerPreset = name.trim();
                this.newServerPresetName = '';
                this.newServerPresetDescription = '';
                store.showToast(store.t('serverPresetSaved') || `Preset "${name}" saved`, 'success');
                document.getElementById('save_server_preset_modal').close();
            } else {
                throw new Error(data.error || 'Failed to save preset');
            }
        } catch (e) {
            store.showToast((store.t('failedToSaveServerPreset') || 'Failed to save preset') + ': ' + e.message, 'error');
        } finally {
            this.savingServerPreset = false;
        }
    },

    async deleteSelectedServerPreset() {
        if (!this.selectedServerPreset) return;

        // Check if built-in
        const preset = this.serverPresets.find(p => p.name === this.selectedServerPreset);
        if (preset?.builtIn) {
            Alpine.store('global').showToast(Alpine.store('global').t('cannotDeleteBuiltIn') || 'Cannot delete built-in presets', 'warning');
            return;
        }

        const store = Alpine.store('global');
        const confirmMsg = store.t('deletePresetConfirm', { name: this.selectedServerPreset });
        if (!confirm(confirmMsg)) return;

        this.deletingServerPreset = true;

        try {
            const { response, newPassword } = await window.utils.request(
                `/api/server/presets/${encodeURIComponent(this.selectedServerPreset)}`,
                { method: 'DELETE' },
                store.webuiPassword
            );
            if (newPassword) store.webuiPassword = newPassword;

            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || `HTTP ${response.status}`);
            }
            const data = await response.json();
            if (data.status === 'ok') {
                this.serverPresets = data.presets || [];
                this.selectedServerPreset = this.serverPresets.length > 0 ? this.serverPresets[0].name : '';
                store.showToast(store.t('serverPresetDeleted') || 'Preset deleted', 'success');
            } else {
                throw new Error(data.error || 'Failed to delete preset');
            }
        } catch (e) {
            store.showToast((store.t('failedToDeleteServerPreset') || 'Failed to delete preset') + ': ' + e.message, 'error');
        } finally {
            this.deletingServerPreset = false;
        }
    },

    isSelectedPresetBuiltIn() {
        const preset = this.serverPresets.find(p => p.name === this.selectedServerPreset);
        return preset?.builtIn === true;
    },

    /**
     * Format a millisecond value to a human-readable string.
     * e.g. 60000 → "1m", 1000 → "1s", 1500 → "1.5s", 90000 → "1m 30s"
     */
    formatMsValue(ms) {
        if (ms == null) return '—';
        if (ms < 1000) return ms + 'ms';
        const totalSeconds = ms / 1000;
        if (totalSeconds < 60) {
            return Number.isInteger(totalSeconds) ? totalSeconds + 's' : totalSeconds.toFixed(1) + 's';
        }
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        if (seconds === 0) return minutes + 'm';
        return minutes + 'm ' + (Number.isInteger(seconds) ? seconds : seconds.toFixed(1)) + 's';
    },

    /**
     * Get preview sections for the currently selected preset.
     * Returns { strategy, strategyLabel, sections } where each section has { label, rows }.
     * Each row has { label, value, differs } where differs is true when the preset
     * value doesn't match the current running serverConfig.
     */
    getPresetPreviewSections() {
        const preset = this.serverPresets.find(p => p.name === this.selectedServerPreset);
        if (!preset?.config) return null;

        const cfg = preset.config;
        const cur = this.serverConfig;
        const store = Alpine.store('global');

        const strategy = cfg.accountSelection?.strategy || 'hybrid';
        const currentStrategy = cur.accountSelection?.strategy || 'hybrid';

        const differs = (presetVal, currentVal) => {
            if (presetVal == null && currentVal == null) return false;
            if (presetVal == null || currentVal == null) return true;
            return JSON.stringify(presetVal) !== JSON.stringify(currentVal);
        };

        const fmtQuota = (val) => {
            if (!val || val === 0) return store.t('quotaDisabled') || 'Disabled';
            return Math.round(val * 100) + '%';
        };

        const sections = [
            {
                label: store.t('networkRetry') || 'Network Retry Settings',
                rows: [
                    { label: store.t('maxRetries') || 'Max Retries', value: cfg.maxRetries ?? '—', differs: differs(cfg.maxRetries, cur.maxRetries) },
                    { label: store.t('retryBaseDelay') || 'Retry Base Delay', value: this.formatMsValue(cfg.retryBaseMs), differs: differs(cfg.retryBaseMs, cur.retryBaseMs) },
                    { label: store.t('retryMaxDelay') || 'Retry Max Delay', value: this.formatMsValue(cfg.retryMaxMs), differs: differs(cfg.retryMaxMs, cur.retryMaxMs) },
                ]
            },
            {
                label: store.t('rateLimiting') || 'Rate Limiting',
                rows: [
                    { label: store.t('defaultCooldown') || 'Default Cooldown', value: this.formatMsValue(cfg.defaultCooldownMs), differs: differs(cfg.defaultCooldownMs, cur.defaultCooldownMs) },
                    { label: store.t('maxWaitThreshold') || 'Max Wait Before Error', value: this.formatMsValue(cfg.maxWaitBeforeErrorMs), differs: differs(cfg.maxWaitBeforeErrorMs, cur.maxWaitBeforeErrorMs) },
                    { label: 'Max Accounts', value: cfg.maxAccounts ?? '—', differs: differs(cfg.maxAccounts, cur.maxAccounts) },
                ]
            },
            {
                label: store.t('quotaProtection') || 'Quota Protection',
                rows: [
                    { label: store.t('minimumQuotaLevel') || 'Minimum Quota Level', value: fmtQuota(cfg.globalQuotaThreshold), differs: differs(cfg.globalQuotaThreshold, cur.globalQuotaThreshold) },
                ]
            },
            {
                label: store.t('errorHandlingTuning') || 'Error Handling',
                rows: [
                    { label: store.t('rateLimitDedupWindow') || 'Dedup Window', value: this.formatMsValue(cfg.rateLimitDedupWindowMs), differs: differs(cfg.rateLimitDedupWindowMs, cur.rateLimitDedupWindowMs) },
                    { label: store.t('maxConsecutiveFailures') || 'Max Consecutive Failures', value: cfg.maxConsecutiveFailures ?? '—', differs: differs(cfg.maxConsecutiveFailures, cur.maxConsecutiveFailures) },
                    { label: store.t('extendedCooldown') || 'Extended Cooldown', value: this.formatMsValue(cfg.extendedCooldownMs), differs: differs(cfg.extendedCooldownMs, cur.extendedCooldownMs) },
                    { label: store.t('maxCapacityRetries') || 'Max Capacity Retries', value: cfg.maxCapacityRetries ?? '—', differs: differs(cfg.maxCapacityRetries, cur.maxCapacityRetries) },
                ]
            }
        ];

        return {
            strategy,
            strategyLabel: this.getStrategyLabel(strategy),
            strategyDiffers: differs(strategy, currentStrategy),
            sections
        };
    }
});
