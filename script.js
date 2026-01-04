// Wedding Planning Journal - OurVows
class OurVowsApp {
    constructor() {
        this.labels = {
            categories: {
                venue: 'Local',
                catering: 'Buffet',
                photography: 'Fotografia',
                videography: 'Filmagem',
                music: 'Música',
                flowers: 'Flores',
                decorations: 'Decoração',
                attire: 'Traje',
                rings: 'Alianças',
                invitations: 'Convites',
                transportation: 'Transporte',
                other: 'Outros'
            },
            expenseStatus: {
                pending: 'Pendente',
                paid: 'Pago',
                installments: 'Parcelado'
            },
            taskStatus: {
                pending: 'Pendente',
                'in-progress': 'Em andamento',
                completed: 'Concluído'
            },
            noteType: {
                text: 'Texto',
                list: 'Checklist',
                idea: 'Ideia'
            },
            checklistCategory: {
                'pre-planning': 'Pré-planejamento',
                venue: 'Local e buffet',
                photography: 'Foto e vídeo',
                attire: 'Trajes e acessórios',
                flowers: 'Flores e decoração',
                music: 'Música e entretenimento',
                guests: 'Convidados e convites',
                documentation: 'Documentação',
                'day-of': 'Dia do casamento'
            },
            priority: {
                high: 'Alta',
                medium: 'Média',
                low: 'Baixa'
            }
        };

        this.data = {
            weddingDate: null,
            budget: {
                total: 0,
                expenses: []
            },
            vendors: [],
            timeline: [],
            notes: [],
            checklist: [],
            gifts: [],
            calendar: [],
            mapMarkers: [],
            homeExpenses: []
        };

        this.giftSettings = {
            supabaseUrl: 'https://merjmhdfauvgoyopivje.supabase.co',
            supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1lcmptaGRmYXV2Z295b3BpdmplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc0NzgxNTMsImV4cCI6MjA4MzA1NDE1M30.Rjzs_nzm-HqYDHygc0FWo-lSGMBOB3y3r_a3AY4cJxY',
            imgbbKey: '9f9e6c35b078c42f5ea619aef46f2791'
        };

        this.ownerCode = '2409JV';
        this.isOwnerAuthorized = false;

        this.supabaseClient = null;
        this.viewMode = 'owner';
        this.guestEventFilter = 'all';

        this.remoteSyncTimer = null;
        this.lastRemoteUpdatedAt = null;

        this.calendarInstance = null;
        this.mapInstance = null;
        this.mapLayerGroup = null;
        
        this.init().catch(() => {
            this.loadData();
            this.setupEventListeners();
            this.updateDashboard();
            this.startCountdown();
        });
    }

    async init() {
        this.loadData();
        this.initSupabaseClient();
        await this.syncStateFromSupabase();
        this.setupEventListeners();
        this.updateDashboard();
        this.startCountdown();
    }

    // Data persistence
    loadData() {
        const savedData = localStorage.getItem('ourVowsData');
        if (savedData) {
            const parsed = JSON.parse(savedData);
            this.data = {
                ...this.data,
                ...parsed,
                budget: {
                    ...this.data.budget,
                    ...(parsed.budget || {})
                },
                vendors: parsed.vendors || [],
                timeline: parsed.timeline || [],
                notes: parsed.notes || [],
                checklist: parsed.checklist || [],
                gifts: parsed.gifts || [],
                calendar: parsed.calendar || [],
                mapMarkers: parsed.mapMarkers || [],
                homeExpenses: parsed.homeExpenses || []
            };
        }

        const giftSettingsRaw = localStorage.getItem('ourVowsGiftSettings');
        if (giftSettingsRaw) {
            try {
                const parsedSettings = JSON.parse(giftSettingsRaw);
                this.giftSettings = {
                    ...this.giftSettings,
                    ...(parsedSettings || {})
                };
            } catch {
                // ignore
            }
        }
    }

    saveData() {
        this.saveDataLocalOnly();
        this.scheduleRemoteStateSave();
    }

    saveDataLocalOnly() {
        localStorage.setItem('ourVowsData', JSON.stringify(this.data));
    }

    async syncStateFromSupabase() {
        this.applyViewMode();
        const sb = this.supabaseClient || this.initSupabaseClient();
        if (!sb) return;

        const { data, error } = await sb
            .from('app_state')
            .select('*')
            .eq('id', 'default')
            .maybeSingle();

        if (error) return;

        const remoteUpdatedAt = data?.updated_at || null;
        const remotePayload = data?.data || null;

        const localRemoteUpdatedAt = localStorage.getItem('ourVowsRemoteUpdatedAt');
        const localRemoteMs = localRemoteUpdatedAt ? Date.parse(localRemoteUpdatedAt) : 0;
        const remoteMs = remoteUpdatedAt ? Date.parse(remoteUpdatedAt) : 0;

        if (remotePayload && remoteMs && remoteMs > localRemoteMs) {
            this.data = {
                ...this.data,
                ...(remotePayload || {}),
                budget: {
                    ...this.data.budget,
                    ...((remotePayload || {}).budget || {})
                },
                vendors: (remotePayload || {}).vendors || [],
                timeline: (remotePayload || {}).timeline || [],
                notes: (remotePayload || {}).notes || [],
                checklist: (remotePayload || {}).checklist || [],
                gifts: (remotePayload || {}).gifts || [],
                calendar: (remotePayload || {}).calendar || [],
                mapMarkers: (remotePayload || {}).mapMarkers || [],
                homeExpenses: (remotePayload || {}).homeExpenses || []
            };
            this.saveDataLocalOnly();
            localStorage.setItem('ourVowsRemoteUpdatedAt', remoteUpdatedAt);
            this.lastRemoteUpdatedAt = remoteUpdatedAt;
        } else if (!data && this.canWriteSupabaseState()) {
            await this.upsertStateToSupabase();
        }
    }

    scheduleRemoteStateSave() {
        if (!this.canWriteSupabaseState()) return;
        if (this.remoteSyncTimer) window.clearTimeout(this.remoteSyncTimer);
        this.remoteSyncTimer = window.setTimeout(() => {
            this.upsertStateToSupabase();
        }, 600);
    }

    async upsertStateToSupabase() {
        if (!this.canWriteSupabaseState()) return false;
        const sb = this.supabaseClient || this.initSupabaseClient();
        if (!sb) return false;

        const payload = {
            id: 'default',
            data: this.data
        };

        const { data, error } = await sb
            .from('app_state')
            .upsert(payload, { onConflict: 'id' })
            .select('updated_at')
            .maybeSingle();

        if (error) return false;
        const updatedAt = data?.updated_at || null;
        if (updatedAt) {
            localStorage.setItem('ourVowsRemoteUpdatedAt', updatedAt);
            this.lastRemoteUpdatedAt = updatedAt;
        }
        return true;
    }

    canWriteSupabaseState() {
        return this.viewMode !== 'guest' && this.isOwnerAuthorized;
    }

    // Navigation
    setupEventListeners() {
        // Home (logo)
        const homeButton = document.getElementById('home-button');
        if (homeButton) {
            homeButton.addEventListener('click', () => {
                this.showSection('dashboard');
                window.scrollTo({ top: 0, behavior: 'smooth' });
            });
        }

        // Nav toggle (mobile)
        const navToggle = document.getElementById('nav-toggle');
        const navList = document.getElementById('nav-list');
        if (navToggle && navList) {
            navToggle.addEventListener('click', () => {
                const isOpen = navList.classList.toggle('open');
                navToggle.setAttribute('aria-expanded', String(isOpen));
            });
        }

        // Modal de links
        const modal = document.getElementById('link-modal');
        const modalClose = document.getElementById('link-modal-close');
        if (modal && modalClose) {
            modalClose.addEventListener('click', () => this.closeLinkModal());
            modal.addEventListener('click', (e) => {
                if (e.target === modal) this.closeLinkModal();
            });
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') this.closeLinkModal();
            });
        }

        // Navigation
        document.querySelectorAll('.nav-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const section = e.target.dataset.section;
                this.showSection(section);

                const navToggleEl = document.getElementById('nav-toggle');
                const navListEl = document.getElementById('nav-list');
                if (navToggleEl && navListEl) {
                    navListEl.classList.remove('open');
                    navToggleEl.setAttribute('aria-expanded', 'false');
                }
            });
        });

        // Wedding date
        const weddingDateInput = document.getElementById('wedding-date');
        if (weddingDateInput) {
            weddingDateInput.addEventListener('change', (e) => {
                this.data.weddingDate = e.target.value;
                this.saveData();
                this.startCountdown();
            });
            
            if (this.data.weddingDate) {
                weddingDateInput.value = this.data.weddingDate;
            }
        }

        // Budget form
        const expenseForm = document.getElementById('expense-form');
        if (expenseForm) {
            expenseForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.addExpense();
            });
        }

        // Vendor form
        const vendorForm = document.getElementById('vendor-form');
        if (vendorForm) {
            vendorForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.addVendor();
            });
        }

        // Timeline form
        const timelineForm = document.getElementById('timeline-form');
        if (timelineForm) {
            timelineForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.addTimelineTask();
            });
        }

        // Notes form
        const notesForm = document.getElementById('notes-form');
        if (notesForm) {
            notesForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.addNote();
            });
        }

        // Checklist form
        const checklistForm = document.getElementById('checklist-form');
        if (checklistForm) {
            checklistForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.addChecklistItem();
            });
        }

        // Lista de presentes (antigo Chás)
        const giftSettingsForm = document.getElementById('gift-settings-form');
        if (giftSettingsForm) {
            giftSettingsForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.saveGiftSettings();
            });
        }

        const giftForm = document.getElementById('gift-form');
        if (giftForm) {
            giftForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.addGift();
            });
        }

        const giftLink = document.getElementById('gift-link');
        const giftTitle = document.getElementById('gift-title');
        if (giftLink && giftTitle) {
            giftLink.addEventListener('blur', () => {
                const currentTitle = (giftTitle.value || '').trim();
                if (currentTitle) return;

                const urlStr = (giftLink.value || '').trim();
                const suggestion = this.suggestGiftTitleFromUrl(urlStr);
                if (suggestion) {
                    giftTitle.value = suggestion;
                }
            });
        }

        const giftFilter = document.getElementById('gift-filter');
        if (giftFilter) {
            giftFilter.addEventListener('change', () => {
                this.guestEventFilter = giftFilter.value || 'all';
                this.updateGifts();
            });
        }

        const giftShareBtn = document.getElementById('gift-share-link');
        if (giftShareBtn) {
            giftShareBtn.addEventListener('click', async () => {
                await this.copyGuestGiftLink();
            });
        }

        // Calendário
        const calendarForm = document.getElementById('calendar-form');
        if (calendarForm) {
            calendarForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.addCalendarEvent();
            });
        }

        // Mapa
        const mapForm = document.getElementById('map-form');
        if (mapForm) {
            mapForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.addMapMarker();
            });
        }

        const mapGeocodeBtn = document.getElementById('map-geocode');
        if (mapGeocodeBtn) {
            mapGeocodeBtn.addEventListener('click', () => {
                this.geocodeAddress();
            });
        }

        // Casa/Contas
        const homeExpenseForm = document.getElementById('home-expense-form');
        if (homeExpenseForm) {
            homeExpenseForm.addEventListener('submit', (e) => {
                e.preventDefault();
                this.addHomeExpense();
            });
        }
    }

    showSection(sectionId) {
        if (this.viewMode === 'guest' && sectionId !== 'teas') {
            sectionId = 'teas';
        }
        // Update navigation
        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.remove('active');
        });
        document.querySelector(`[data-section="${sectionId}"]`).classList.add('active');

        // Update sections
        document.querySelectorAll('.section').forEach(section => {
            section.classList.remove('active');
        });
        document.getElementById(sectionId).classList.add('active');

        // Update section content
        this.updateSection(sectionId);
    }

    updateSection(sectionId) {
        switch(sectionId) {
            case 'dashboard':
                this.updateDashboard();
                break;
            case 'budget':
                this.updateBudget();
                break;
            case 'vendors':
                this.updateVendors();
                break;
            case 'timeline':
                this.updateTimeline();
                break;
            case 'notes':
                this.updateNotes();
                break;
            case 'checklist':
                this.updateChecklist();
                break;
            case 'teas':
                this.updateGifts(true);
                break;
            case 'calendar':
                this.updateCalendar();
                break;
            case 'map':
                this.updateMap();
                break;
            case 'home':
                this.updateHomeExpenses();
                break;
        }
    }

    getQueryParams() {
        const params = new URLSearchParams(window.location.search);
        const view = (params.get('view') || '').toLowerCase();
        const event = (params.get('event') || '').toLowerCase();
        const owner = (params.get('owner') || '').trim();
        return { view, event, owner };
    }

    applyViewMode() {
        const { view, event, owner } = this.getQueryParams();

        const ownerRaw = String(owner || '').trim();
        this.isOwnerAuthorized = ownerRaw && ownerRaw.toUpperCase() === String(this.ownerCode).toUpperCase();

        if (view === 'guest') {
            this.viewMode = 'guest';
            this.guestEventFilter = event || 'all';
        } else {
            this.viewMode = 'owner';
        }

        document.body.classList.toggle('guest-mode', this.viewMode === 'guest');

        const hint = document.getElementById('gift-view-hint');
        if (hint) {
            hint.textContent = this.viewMode === 'guest'
                ? 'Modo Convidado: selecione e reserve um presente.'
                : 'Modo Casal: adicione itens e gerencie a lista.';
        }

        const settingsForm = document.getElementById('gift-settings-form');
        const giftForm = document.getElementById('gift-form');
        if (this.viewMode === 'guest' || !this.isOwnerAuthorized) {
            if (settingsForm) settingsForm.closest('.card')?.classList.add('hidden');
            if (giftForm) giftForm.closest('.card')?.classList.add('hidden');
        } else {
            if (settingsForm) settingsForm.closest('.card')?.classList.remove('hidden');
            if (giftForm) giftForm.closest('.card')?.classList.remove('hidden');
        }

        const giftFilter = document.getElementById('gift-filter');
        if (giftFilter) {
            giftFilter.value = this.guestEventFilter || 'all';
        }

        const giftShareBtn = document.getElementById('gift-share-link');
        if (giftShareBtn) {
            if (this.viewMode === 'guest') {
                giftShareBtn.classList.add('hidden');
            } else {
                giftShareBtn.classList.remove('hidden');
            }
        }

        if (this.viewMode === 'guest') {
            const teasSection = document.getElementById('teas');
            if (teasSection && !teasSection.classList.contains('active')) {
                this.showSection('teas');
            }
        }
    }

    buildGuestGiftUrl(eventFilter) {
        const url = new URL(window.location.href);
        url.searchParams.set('view', 'guest');
        const event = (eventFilter || 'all').toLowerCase();
        if (event === 'all') {
            url.searchParams.delete('event');
        } else {
            url.searchParams.set('event', event);
        }
        return url.toString();
    }

    async copyGuestGiftLink() {
        if (this.viewMode === 'guest') return;

        const filterEl = document.getElementById('gift-filter');
        const filter = (filterEl?.value || this.guestEventFilter || 'all').toLowerCase();
        const url = this.buildGuestGiftUrl(filter);

        try {
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                await navigator.clipboard.writeText(url);
            } else {
                const ta = document.createElement('textarea');
                ta.value = url;
                ta.setAttribute('readonly', '');
                ta.style.position = 'fixed';
                ta.style.top = '-1000px';
                ta.style.left = '-1000px';
                document.body.appendChild(ta);
                ta.select();
                document.execCommand('copy');
                ta.remove();
            }

            const label = filter === 'all' ? 'todos' : this.getGiftEventLabel(filter);
            this.showNotification(`Link de convidados copiado (${label})!`);
        } catch {
            this.showNotification('Não foi possível copiar o link automaticamente.');
            prompt('Copie o link para convidados:', url);
        }
    }

    initSupabaseClient() {
        const url = (this.giftSettings?.supabaseUrl || '').trim();
        const key = (this.giftSettings?.supabaseAnonKey || '').trim();
        if (!url || !key) {
            this.supabaseClient = null;
            return null;
        }

        if (!window.supabase || typeof window.supabase.createClient !== 'function') {
            this.supabaseClient = null;
            return null;
        }

        this.supabaseClient = window.supabase.createClient(url, key);
        return this.supabaseClient;
    }

    saveGiftSettings() {
        const urlEl = document.getElementById('supabase-url');
        const keyEl = document.getElementById('supabase-anon-key');
        const imgbbEl = document.getElementById('imgbb-key');
        this.giftSettings = {
            supabaseUrl: (urlEl?.value || '').trim(),
            supabaseAnonKey: (keyEl?.value || '').trim(),
            imgbbKey: (imgbbEl?.value || '').trim()
        };
        localStorage.setItem('ourVowsGiftSettings', JSON.stringify(this.giftSettings));
        this.initSupabaseClient();
        this.showNotification('Configurações salvas!');
        this.updateGifts(true);
    }

    hydrateGiftSettingsForm() {
        const urlEl = document.getElementById('supabase-url');
        const keyEl = document.getElementById('supabase-anon-key');
        const imgbbEl = document.getElementById('imgbb-key');
        if (urlEl) urlEl.value = this.giftSettings?.supabaseUrl || '';
        if (keyEl) keyEl.value = this.giftSettings?.supabaseAnonKey || '';
        if (imgbbEl) imgbbEl.value = this.giftSettings?.imgbbKey || '';
    }

    getGiftEventLabel(code) {
        switch ((code || '').toLowerCase()) {
            case 'cha-de-panela': return 'Chá de panela';
            case 'casa-nova': return 'Casa nova';
            case 'lingerie': return 'Lingerie';
            default: return 'Outros';
        }
    }

    async fetchGiftsFromSupabase() {
        const sb = this.supabaseClient || this.initSupabaseClient();
        if (!sb) return null;
        const { data, error } = await sb
            .from('gifts')
            .select('*')
            .order('created_at', { ascending: false });
        if (error) {
            this.showNotification('Falha ao carregar presentes (Supabase).');
            return null;
        }
        return Array.isArray(data) ? data : [];
    }

    async upsertGiftToSupabase(gift) {
        const sb = this.supabaseClient || this.initSupabaseClient();
        if (!sb) return false;

        if (!this.isOwnerAuthorized) {
            return false;
        }

        const payload = {
            id: String(gift.id),
            event: gift.event,
            link: gift.link,
            title: gift.title,
            price: gift.price,
            image_url: gift.imageUrl || null,
            reserved_by: gift.reservedBy || null,
            reserved_at: gift.reservedAt || null
        };

        const { error } = await sb
            .from('gifts')
            .upsert(payload, { onConflict: 'id' });

        if (error) {
            this.showNotification('Falha ao salvar presente (Supabase).');
            return false;
        }
        return true;
    }

    async reserveGiftInSupabase(giftId, reservedBy) {
        const sb = this.supabaseClient || this.initSupabaseClient();
        if (!sb) return false;

        const now = new Date().toISOString();
        const { data, error } = await sb
            .from('gifts')
            .update({ reserved_by: reservedBy, reserved_at: now })
            .eq('id', String(giftId))
            .is('reserved_by', null)
            .select('*')
            .maybeSingle();

        if (error) {
            this.showNotification('Falha ao reservar (Supabase).');
            return false;
        }

        if (!data) {
            this.showNotification('Esse item já foi reservado por outra pessoa.');
            return false;
        }

        return true;
    }

    async deleteGiftFromSupabase(giftId) {
        const sb = this.supabaseClient || this.initSupabaseClient();
        if (!sb) return false;

        if (!this.isOwnerAuthorized) {
            return false;
        }
        const { error } = await sb.from('gifts').delete().eq('id', String(giftId));
        if (error) {
            this.showNotification('Falha ao excluir (Supabase).');
            return false;
        }
        return true;
    }

    async addGift() {
        if (this.viewMode === 'guest') return;

        const eventEl = document.getElementById('gift-event');
        const linkEl = document.getElementById('gift-link');
        const titleEl = document.getElementById('gift-title');
        const priceEl = document.getElementById('gift-price');
        const imageEl = document.getElementById('gift-image');

        const event = (eventEl?.value || '').trim();
        const link = (linkEl?.value || '').trim();
        const title = (titleEl?.value || '').trim();
        const price = parseFloat(priceEl?.value || '0');
        if (!event || !link || !title || !Number.isFinite(price)) {
            this.showNotification('Preencha evento, link, nome e valor.');
            return;
        }

        let imageUrl = '';
        const file = imageEl?.files?.[0];
        if (file) {
            const key = (this.giftSettings?.imgbbKey || '').trim();
            if (!key) {
                this.showNotification('Adicione a API key do ImgBB em Configurações para enviar a foto.');
            } else {
                try {
                    imageUrl = await this.uploadImageToImgBB(file, key);
                } catch {
                    this.showNotification('Falha ao enviar foto para o ImgBB.');
                }
            }
        }

        const gift = {
            id: Date.now(),
            event,
            link,
            title,
            price,
            imageUrl,
            reservedBy: null,
            reservedAt: null,
            createdAt: new Date().toISOString()
        };

        const savedRemotely = await this.upsertGiftToSupabase(gift);
        if (!savedRemotely) {
            this.data.gifts = Array.isArray(this.data.gifts) ? this.data.gifts : [];
            this.data.gifts.push(gift);
            this.saveData();
        }

        document.getElementById('gift-form')?.reset();
        this.showNotification('Presente adicionado!');
        this.updateGifts(true);
    }

    async reserveGift(giftId) {
        const list = this.getCurrentGiftList();
        const gift = list.find(g => String(g.id) === String(giftId));
        if (!gift) return;
        if (gift.reservedBy) {
            this.showNotification('Esse item já está reservado.');
            return;
        }

        const reservedBy = prompt('Digite seu nome para reservar este presente:');
        if (!reservedBy || !reservedBy.trim()) return;

        const ok = await this.reserveGiftInSupabase(giftId, reservedBy.trim());
        if (!ok) return;
        this.showNotification('Presente reservado! Obrigado ❤️');
        this.updateGifts(true);
    }

    async deleteGift(giftId) {
        if (this.viewMode === 'guest') return;
        const ok = confirm('Excluir este presente?');
        if (!ok) return;

        const remoteOk = await this.deleteGiftFromSupabase(giftId);
        if (!remoteOk) {
            this.data.gifts = (this.data.gifts || []).filter(g => String(g.id) !== String(giftId));
            this.saveData();
        }
        this.updateGifts(true);
    }

    getCurrentGiftList() {
        return Array.isArray(this.data.gifts) ? this.data.gifts : [];
    }

    async updateGifts(forceReload = false) {
        const listEl = document.getElementById('gift-list');
        if (!listEl) return;

        this.applyViewMode();
        this.hydrateGiftSettingsForm();
        this.initSupabaseClient();

        if (forceReload) {
            const remote = await this.fetchGiftsFromSupabase();
            if (remote) {
                this.data.gifts = remote.map(r => ({
                    id: r.id,
                    event: r.event,
                    link: r.link,
                    title: r.title,
                    price: parseFloat(r.price || 0),
                    imageUrl: r.image_url || '',
                    reservedBy: r.reserved_by || null,
                    reservedAt: r.reserved_at || null,
                    createdAt: r.created_at || null
                }));
                this.saveData();
            }
        }

        const filter = this.guestEventFilter || 'all';
        const gifts = this.getCurrentGiftList().filter(g => {
            if (filter === 'all') return true;
            return String(g.event) === String(filter);
        });

        if (gifts.length === 0) {
            listEl.innerHTML = '<div class="meta">Nenhum item ainda.</div>';
            return;
        }

        listEl.innerHTML = gifts.map(g => {
            const isReserved = Boolean(g.reservedBy);
            const reserveBtn = isReserved
                ? `<button class="btn-secondary btn-disabled" disabled>Reservado</button>`
                : `<button class="btn-primary" onclick="app.reserveGift('${this.escapeHtmlAttr(String(g.id))}')">Reservar</button>`;
            const deleteBtn = this.viewMode === 'guest'
                ? ''
                : `<button class="btn-delete" onclick="app.deleteGift('${this.escapeHtmlAttr(String(g.id))}')">Excluir</button>`;
            const reservedInfo = (this.viewMode !== 'guest' && isReserved && g.reservedBy)
                ? `<div class="meta">Reservado por: ${this.escapeHtml(g.reservedBy)}</div>`
                : '';

            return `
                <div class="gift-card">
                    ${g.imageUrl ? `<img class="gift-image" src="${this.escapeHtmlAttr(g.imageUrl)}" alt="${this.escapeHtmlAttr(g.title)}" loading="lazy">` : `<div class="gift-image"></div>`}
                    <div class="gift-body">
                        <h4 class="gift-title">${this.escapeHtml(g.title)}</h4>
                        <div class="gift-meta">
                            <span class="gift-event">${this.escapeHtml(this.getGiftEventLabel(g.event))}</span>
                            <span class="gift-price">${this.formatCurrency(g.price)}</span>
                        </div>
                        <div class="gift-actions">
                            ${reserveBtn}
                            <a class="btn-secondary btn-link" href="${this.escapeHtmlAttr(g.link)}" target="_blank" rel="noopener noreferrer">Ver link</a>
                            ${reservedInfo}
                            ${deleteBtn}
                        </div>
                    </div>
                </div>
            `;
        }).join('');
    }

    async compressImage(file, maxWidth = 1200, quality = 0.75) {
        const img = await this.loadImageFromFile(file);
        const canvas = document.createElement('canvas');

        const ratio = img.width > maxWidth ? (maxWidth / img.width) : 1;
        const w = Math.round(img.width * ratio);
        const h = Math.round(img.height * ratio);
        canvas.width = w;
        canvas.height = h;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, w, h);

        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
        if (!blob) throw new Error('compress failed');
        return blob;
    }

    loadImageFromFile(file) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => {
                URL.revokeObjectURL(url);
                resolve(img);
            };
            img.onerror = (e) => {
                URL.revokeObjectURL(url);
                reject(e);
            };
            img.src = url;
        });
    }

    async uploadImageToImgBB(file, apiKey) {
        const compressed = await this.compressImage(file);
        const base64 = await this.blobToBase64(compressed);
        const base64Data = base64.includes(',') ? base64.split(',')[1] : base64;

        const form = new FormData();
        form.append('image', base64Data);

        const res = await fetch(`https://api.imgbb.com/1/upload?key=${encodeURIComponent(apiKey)}`, {
            method: 'POST',
            body: form
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const url = json?.data?.url || json?.data?.display_url;
        if (!url) throw new Error('no url');
        return url;
    }

    blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(String(reader.result || ''));
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    suggestGiftTitleFromUrl(urlStr) {
        if (!urlStr) return '';
        try {
            const u = new URL(urlStr);
            const last = (u.pathname || '').split('/').filter(Boolean).pop() || '';
            const decoded = decodeURIComponent(last).replace(/[-_]+/g, ' ').trim();
            if (decoded && decoded.length >= 3) return decoded;
            return u.hostname.replace(/^www\./, '');
        } catch {
            return '';
        }
    }

    addCalendarEvent() {
        const title = document.getElementById('cal-title').value;
        const date = document.getElementById('cal-date').value;
        const time = document.getElementById('cal-time').value;
        const notes = document.getElementById('cal-notes').value;
        const color = document.getElementById('cal-color')?.value || '#c8b8a3';
        const start = time ? `${date}T${time}` : date;

        const ev = {
            id: String(Date.now()),
            title,
            start,
            allDay: !time,
            extendedProps: {
                notes
            },
            backgroundColor: color,
            borderColor: color,
            textColor: '#ffffff'
        };

        this.data.calendar.push(ev);
        this.saveData();
        document.getElementById('calendar-form').reset();
        this.updateCalendar(true);
        this.showNotification('Lembrete adicionado!');
    }

    updateCalendar(forceRerender = false) {
        const root = document.getElementById('calendar-root');
        if (!root) return;

        if (!window.FullCalendar) {
            root.innerHTML = '<div class="meta">Calendário indisponível (biblioteca não carregou).</div>';
            return;
        }

        if (!this.calendarInstance) {
            this.calendarInstance = new FullCalendar.Calendar(root, {
                initialView: 'dayGridMonth',
                locale: 'pt-br',
                height: 'auto',
                headerToolbar: {
                    left: 'prev,next today',
                    center: 'title',
                    right: 'dayGridMonth,timeGridWeek,timeGridDay'
                },
                events: this.data.calendar,
                eventClick: (info) => {
                    const notes = info.event.extendedProps?.notes;
                    const ok = confirm(`Excluir lembrete "${info.event.title}"?${notes ? `\n\nObs: ${notes}` : ''}`);
                    if (ok) {
                        this.deleteCalendarEvent(info.event.id);
                    }
                }
            });
            this.calendarInstance.render();
            return;
        }

        if (forceRerender) {
            this.calendarInstance.removeAllEvents();
            this.data.calendar.forEach(ev => this.calendarInstance.addEvent(ev));
        }
    }

    deleteCalendarEvent(id) {
        this.data.calendar = this.data.calendar.filter(e => e.id !== String(id));
        this.saveData();
        if (this.calendarInstance) {
            const ev = this.calendarInstance.getEventById(String(id));
            if (ev) ev.remove();
        }
        this.showNotification('Lembrete excluído!');
    }

    addMapMarker() {
        const marker = {
            id: Date.now(),
            type: document.getElementById('map-type').value,
            title: document.getElementById('map-title').value,
            lat: parseFloat(document.getElementById('map-lat').value),
            lng: parseFloat(document.getElementById('map-lng').value),
            notes: document.getElementById('map-notes').value,
            createdAt: new Date().toISOString()
        };

        if (Number.isNaN(marker.lat) || Number.isNaN(marker.lng)) {
            this.showNotification('Latitude/Longitude inválidas.');
            return;
        }

        this.data.mapMarkers.push(marker);
        this.saveData();
        document.getElementById('map-form').reset();
        this.updateMap(true);
        this.showNotification('Marcador adicionado!');
    }

    updateMap(force = false) {
        const root = document.getElementById('map-root');
        const list = document.getElementById('map-list');
        if (!root || !list) return;

        if (!window.L) {
            root.innerHTML = '<div class="meta">Mapa indisponível (biblioteca não carregou).</div>';
            return;
        }

        if (!this.mapInstance) {
            const initial = this.data.mapMarkers[0] || { lat: -23.55052, lng: -46.633308 };
            this.mapInstance = L.map(root).setView([initial.lat, initial.lng], 12);
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                maxZoom: 19,
                attribution: '&copy; OpenStreetMap'
            }).addTo(this.mapInstance);
            this.mapLayerGroup = L.layerGroup().addTo(this.mapInstance);
            force = true;
        }

        if (force && this.mapLayerGroup) {
            this.mapLayerGroup.clearLayers();
            this.data.mapMarkers.forEach(m => {
                const popup = `<strong>${this.escapeHtml(m.title)}</strong><br>${this.escapeHtml(this.capitalizeFirst(m.type))}${m.notes ? `<br><em>${this.escapeHtml(m.notes)}</em>` : ''}`;
                L.marker([m.lat, m.lng]).addTo(this.mapLayerGroup).bindPopup(popup);
            });
            if (this.data.mapMarkers.length) {
                const bounds = L.latLngBounds(this.data.mapMarkers.map(m => [m.lat, m.lng]));
                this.mapInstance.fitBounds(bounds, { padding: [30, 30] });
            }

            setTimeout(() => this.mapInstance.invalidateSize(), 0);
        }

        list.innerHTML = this.data.mapMarkers.map(m => {
            const meta = `${this.capitalizeFirst(m.type)} • ${m.lat.toFixed(6)}, ${m.lng.toFixed(6)}`;
            return `
                <div class="item-row">
                    <div>
                        <h4>${this.escapeHtml(m.title)}</h4>
                        <div class="meta">${this.escapeHtml(meta)}</div>
                        ${m.notes ? `<div class="meta meta-tight">${this.escapeHtml(m.notes)}</div>` : ''}
                    </div>
                    <div class="actions">
                        <button class="btn-secondary" onclick="app.focusMapMarker(${m.id})">Ver no mapa</button>
                        <button class="btn-delete" onclick="app.deleteMapMarker(${m.id})">Excluir</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    focusMapMarker(id) {
        const m = this.data.mapMarkers.find(x => x.id === id);
        if (!m || !this.mapInstance) return;
        this.mapInstance.setView([m.lat, m.lng], 15);
    }

    deleteMapMarker(id) {
        this.data.mapMarkers = this.data.mapMarkers.filter(m => m.id !== id);
        this.saveData();
        this.updateMap(true);
        this.showNotification('Marcador excluído!');
    }

    addHomeExpense() {
        const item = {
            id: Date.now(),
            type: document.getElementById('home-type').value,
            description: document.getElementById('home-desc').value,
            amount: parseFloat(document.getElementById('home-amount').value),
            dueDate: document.getElementById('home-due').value,
            status: document.getElementById('home-status').value,
            createdAt: new Date().toISOString()
        };

        if (Number.isNaN(item.amount)) {
            this.showNotification('Valor inválido.');
            return;
        }

        this.data.homeExpenses.push(item);
        this.saveData();
        document.getElementById('home-expense-form').reset();
        this.updateHomeExpenses();
        this.showNotification('Conta adicionada!');
    }

    updateHomeExpenses() {
        const list = document.getElementById('home-expense-list');
        const summary = document.getElementById('home-summary');
        if (!list || !summary) return;

        const total = this.data.homeExpenses.reduce((s, x) => s + (x.amount || 0), 0);
        const pending = this.data.homeExpenses.filter(x => x.status === 'pending').reduce((s, x) => s + (x.amount || 0), 0);
        const paid = this.data.homeExpenses.filter(x => x.status === 'paid').reduce((s, x) => s + (x.amount || 0), 0);

        summary.innerHTML = `
            <div class="expense-summary">
                <div class="summary-item"><span>Total</span><span>${this.formatCurrency(total)}</span></div>
                <div class="summary-item"><span>Pendente</span><span>${this.formatCurrency(pending)}</span></div>
                <div class="summary-item"><span>Pago</span><span>${this.formatCurrency(paid)}</span></div>
            </div>
        `;

        const sorted = [...this.data.homeExpenses].sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

        list.innerHTML = sorted.map(x => {
            const meta = `${this.capitalizeFirst(x.type)} • Venc: ${this.formatDateBR(x.dueDate)} • ${this.getExpenseStatusLabel(x.status)}`;
            return `
                <div class="item-row">
                    <div>
                        <h4>${this.escapeHtml(x.description)}</h4>
                        <div class="meta">${this.escapeHtml(meta)}</div>
                        <div class="meta meta-tight meta-strong">${this.formatCurrency(x.amount)}</div>
                    </div>
                    <div class="actions">
                        <button class="btn-secondary" onclick="app.toggleHomeExpenseStatus(${x.id})">Marcar ${x.status === 'paid' ? 'pendente' : 'pago'}</button>
                        <button class="btn-delete" onclick="app.deleteHomeExpense(${x.id})">Excluir</button>
                    </div>
                </div>
            `;
        }).join('');
    }

    toggleHomeExpenseStatus(id) {
        const item = this.data.homeExpenses.find(x => x.id === id);
        if (!item) return;
        item.status = item.status === 'paid' ? 'pending' : 'paid';
        this.saveData();
        this.updateHomeExpenses();
        this.updateDashboard();
    }

    deleteHomeExpense(id) {
        this.data.homeExpenses = this.data.homeExpenses.filter(x => x.id !== id);
        this.saveData();
        this.updateHomeExpenses();
        this.showNotification('Conta excluída!');
    }

    // Dashboard
    updateDashboard() {
        this.updateBudgetOverview();
        this.updateProgressStats();
    }

    updateBudgetOverview() {
        const totalSpent = this.data.budget.expenses.reduce((sum, expense) => sum + (expense.paid || 0), 0);
        const totalBudget = this.data.budget.expenses.reduce((sum, expense) => sum + (expense.estimated || 0), 0);
        const remaining = totalBudget - totalSpent;

        document.getElementById('total-budget').textContent = this.formatCurrency(totalBudget);
        document.getElementById('total-spent').textContent = this.formatCurrency(totalSpent);
        document.getElementById('total-remaining').textContent = this.formatCurrency(remaining);

        const progressPercent = totalBudget > 0 ? (totalSpent / totalBudget) * 100 : 0;
        document.getElementById('budget-progress').style.width = `${Math.min(progressPercent, 100)}%`;
    }

    updateProgressStats() {
        const completedTasks = this.data.timeline.filter(task => task.status === 'completed').length;
        const bookedVendors = this.data.vendors.length;
        const completedChecklist = this.data.checklist.filter(item => item.completed).length;
        const totalChecklist = this.data.checklist.length;
        const checklistPercentage = totalChecklist > 0 ? Math.round((completedChecklist / totalChecklist) * 100) : 0;

        document.getElementById('tasks-completed').textContent = completedTasks;
        document.getElementById('vendors-booked').textContent = bookedVendors;
        document.getElementById('checklist-percentage').textContent = `${checklistPercentage}%`;
    }

    // Countdown
    startCountdown() {
        if (!this.data.weddingDate) return;

        const updateCountdown = () => {
            const now = new Date().getTime();
            const weddingTime = new Date(this.data.weddingDate).getTime();
            const distance = weddingTime - now;

            if (distance < 0) {
                document.getElementById('days').textContent = '0';
                document.getElementById('hours').textContent = '0';
                return;
            }

            const days = Math.floor(distance / (1000 * 60 * 60 * 24));
            const hours = Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));

            document.getElementById('days').textContent = days;
            document.getElementById('hours').textContent = hours;
        };

        updateCountdown();
        setInterval(updateCountdown, 1000 * 60 * 60); // Update every hour
    }

    // Budget functions
    addExpense() {
        const expense = {
            id: Date.now(),
            category: document.getElementById('expense-category').value,
            description: document.getElementById('expense-description').value,
            estimated: parseFloat(document.getElementById('expense-estimated').value),
            paid: parseFloat(document.getElementById('expense-paid').value) || 0,
            status: document.getElementById('expense-status').value,
            date: new Date().toISOString()
        };

        this.data.budget.expenses.push(expense);
        this.saveData();
        this.updateBudget();
        
        // Reset form
        document.getElementById('expense-form').reset();
        
        // Show success message
        this.showNotification('Despesa adicionada com sucesso!');
    }

    updateBudget() {
        this.updateBudgetOverview();
        this.renderExpenses();
    }

    renderExpenses() {
        const expenseList = document.getElementById('expense-list');
        const totalEstimated = this.data.budget.expenses.reduce((sum, expense) => sum + expense.estimated, 0);
        const totalPaid = this.data.budget.expenses.reduce((sum, expense) => sum + expense.paid, 0);

        document.getElementById('summary-estimated').textContent = this.formatCurrency(totalEstimated);
        document.getElementById('summary-paid').textContent = this.formatCurrency(totalPaid);

        expenseList.innerHTML = this.data.budget.expenses.map(expense => `
            <tr>
                <td>${this.getCategoryLabel(expense.category)}</td>
                <td>${expense.description}</td>
                <td>${this.formatCurrency(expense.estimated)}</td>
                <td>${this.formatCurrency(expense.paid)}</td>
                <td><span class="status-badge status-${expense.status}">${this.getExpenseStatusLabel(expense.status)}</span></td>
                <td><button class="btn-delete" onclick="app.deleteExpense(${expense.id})">Excluir</button></td>
            </tr>
        `).join('');
    }

    deleteExpense(id) {
        this.data.budget.expenses = this.data.budget.expenses.filter(expense => expense.id !== id);
        this.saveData();
        this.updateBudget();
        this.showNotification('Despesa excluída com sucesso!');
    }

    // Vendor functions
    addVendor() {
        const vendor = {
            id: Date.now(),
            name: document.getElementById('vendor-name').value,
            service: document.getElementById('vendor-service').value,
            contact: document.getElementById('vendor-contact').value,
            phone: document.getElementById('vendor-phone').value,
            email: document.getElementById('vendor-email').value,
            instagram: (document.getElementById('vendor-instagram')?.value || '').trim(),
            website: (document.getElementById('vendor-website')?.value || '').trim(),
            price: parseFloat(document.getElementById('vendor-price').value) || 0,
            notes: document.getElementById('vendor-notes').value,
            date: new Date().toISOString()
        };

        this.data.vendors.push(vendor);
        this.saveData();
        this.updateVendors();
        
        // Reset form
        document.getElementById('vendor-form').reset();
        
        this.showNotification('Fornecedor adicionado com sucesso!');
    }

    updateVendors() {
        const vendorList = document.getElementById('vendor-list');
        
        vendorList.innerHTML = this.data.vendors.map(vendor => `
            <div class="vendor-card">
                <h4>${vendor.name}</h4>
                <span class="vendor-service">${this.getCategoryLabel(vendor.service)}</span>
                <div class="vendor-contact-info">${vendor.contact}</div>
                <div class="vendor-contact-info">${vendor.phone}</div>
                <div class="vendor-contact-info">${vendor.email}</div>
                ${vendor.instagram ? `<div class="vendor-contact-info"><button class="btn-accent" onclick="app.openLinkPreview('${this.escapeHtmlAttr(vendor.instagram)}','instagram')">Ver Instagram</button></div>` : ''}
                ${vendor.website ? `<div class="vendor-contact-info"><button class="btn-accent" onclick="app.openLinkPreview('${this.escapeHtmlAttr(vendor.website)}','site')">Ver Site</button></div>` : ''}
                <div class="vendor-price">${this.formatCurrency(vendor.price)}</div>
                ${vendor.notes ? `<div class="vendor-notes">${vendor.notes}</div>` : ''}
                <button class="btn-delete mt-1" onclick="app.deleteVendor(${vendor.id})">Excluir</button>
            </div>
        `).join('');
    }

    deleteVendor(id) {
        this.data.vendors = this.data.vendors.filter(vendor => vendor.id !== id);
        this.saveData();
        this.updateVendors();
        this.showNotification('Fornecedor excluído com sucesso!');
    }

    // Timeline functions
    addTimelineTask() {
        const task = {
            id: Date.now(),
            month: document.getElementById('task-month').value,
            description: document.getElementById('task-description').value,
            status: document.getElementById('task-status').value,
            date: new Date().toISOString()
        };

        this.data.timeline.push(task);
        this.saveData();
        this.updateTimeline();
        
        // Reset form
        document.getElementById('timeline-form').reset();
        
        this.showNotification('Tarefa adicionada com sucesso!');
    }

    updateTimeline() {
        const timelineList = document.getElementById('timeline-list');
        
        // Sort by month
        const sortedTasks = [...this.data.timeline].sort((a, b) => new Date(a.month) - new Date(b.month));
        
        timelineList.innerHTML = sortedTasks.map(task => `
            <div class="timeline-item">
                <div class="timeline-month">${this.formatMonth(task.month)}</div>
                <div class="timeline-task">${task.description}</div>
                <span class="timeline-status status-${task.status}">${this.getTaskStatusLabel(task.status)}</span>
                <button class="btn-delete mt-05" onclick="app.deleteTimelineTask(${task.id})">Excluir</button>
            </div>
        `).join('');
    }

    deleteTimelineTask(id) {
        this.data.timeline = this.data.timeline.filter(task => task.id !== id);
        this.saveData();
        this.updateTimeline();
        this.showNotification('Tarefa excluída com sucesso!');
    }

    // Notes functions
    addNote() {
        const note = {
            id: Date.now(),
            type: document.getElementById('note-type').value,
            title: document.getElementById('note-title').value,
            content: document.getElementById('note-content').value,
            date: new Date().toISOString()
        };

        this.data.notes.push(note);
        this.saveData();
        this.updateNotes();
        
        // Reset form
        document.getElementById('notes-form').reset();
        
        this.showNotification('Nota adicionada com sucesso!');
    }

    updateNotes() {
        const notesList = document.getElementById('notes-list');
        
        notesList.innerHTML = this.data.notes.map(note => `
            <div class="note-card">
                <span class="note-type">${this.getNoteTypeLabel(note.type)}</span>
                <h3 class="note-title">${note.title}</h3>
                <div class="note-content">${this.formatNoteContent(note.content)}</div>
                <button class="btn-delete mt-1" onclick="app.deleteNote(${note.id})">Excluir</button>
            </div>
        `).join('');
    }

    deleteNote(id) {
        this.data.notes = this.data.notes.filter(note => note.id !== id);
        this.saveData();
        this.updateNotes();
        this.showNotification('Nota excluída com sucesso!');
    }

    // Checklist functions
    addChecklistItem() {
        const item = {
            id: Date.now(),
            category: document.getElementById('checklist-category').value,
            item: document.getElementById('checklist-item').value,
            priority: document.getElementById('checklist-priority').value,
            completed: false,
            date: new Date().toISOString()
        };

        this.data.checklist.push(item);
        this.saveData();
        this.updateChecklist();
        
        // Reset form
        document.getElementById('checklist-form').reset();
        
        this.showNotification('Item adicionado ao checklist!');
    }

    updateChecklist() {
        const checklistList = document.getElementById('checklist-list');
        const completed = this.data.checklist.filter(item => item.completed).length;
        const total = this.data.checklist.length;
        const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

        document.getElementById('checklist-completed').textContent = completed;
        document.getElementById('checklist-total').textContent = total;
        document.getElementById('checklist-progress-bar').style.width = `${percentage}%`;

        // Group by category
        const grouped = this.data.checklist.reduce((groups, item) => {
            if (!groups[item.category]) {
                groups[item.category] = [];
            }
            groups[item.category].push(item);
            return groups;
        }, {});

        checklistList.innerHTML = Object.keys(grouped).map(category => `
            <div class="checklist-category">
                <h4>${this.getChecklistCategoryLabel(category)}</h4>
                ${grouped[category].map(item => `
                    <div class="checklist-item ${item.completed ? 'completed' : ''} priority-${item.priority}">
                        <input type="checkbox" id="check-${item.id}" ${item.completed ? 'checked' : ''} 
                               onchange="app.toggleChecklistItem(${item.id})">
                        <label for="check-${item.id}">${item.item}</label>
                        <button class="btn-delete" onclick="app.deleteChecklistItem(${item.id})">Excluir</button>
                    </div>
                `).join('')}
            </div>
        `).join('');
    }

    toggleChecklistItem(id) {
        const item = this.data.checklist.find(item => item.id === id);
        if (item) {
            item.completed = !item.completed;
            this.saveData();
            this.updateChecklist();
            this.updateDashboard();
        }
    }

    deleteChecklistItem(id) {
        this.data.checklist = this.data.checklist.filter(item => item.id !== id);
        this.saveData();
        this.updateChecklist();
        this.showNotification('Item do checklist excluído!');
    }

    openLinkPreview(url, kind) {
        const normalizedUrl = (url || '').trim();
        if (!normalizedUrl) return;

        const modal = document.getElementById('link-modal');
        const iframe = document.getElementById('link-modal-iframe');
        const msg = document.getElementById('link-modal-message');
        const external = document.getElementById('link-modal-open-external');
        const title = document.getElementById('link-modal-title');
        if (!modal || !iframe || !msg || !external || !title) return;

        const { iframeUrl, message, titleText } = this.buildEmbedUrl(normalizedUrl, kind);

        title.textContent = titleText;
        external.href = normalizedUrl;

        if (message) {
            msg.textContent = message;
            msg.classList.remove('hidden');
        } else {
            msg.textContent = '';
            msg.classList.add('hidden');
        }

        iframe.src = iframeUrl;
        modal.classList.add('open');
        modal.setAttribute('aria-hidden', 'false');
    }

    closeLinkModal() {
        const modal = document.getElementById('link-modal');
        const iframe = document.getElementById('link-modal-iframe');
        const msg = document.getElementById('link-modal-message');
        if (!modal || !iframe || !msg) return;
        iframe.src = 'about:blank';
        msg.textContent = '';
        msg.classList.add('hidden');
        modal.classList.remove('open');
        modal.setAttribute('aria-hidden', 'true');
    }

    buildEmbedUrl(url, kind) {
        // Instagram: perfis geralmente NÃO permitem iframe; posts/reels têm endpoint de embed.
        if (kind === 'instagram' && /instagram\.com/i.test(url)) {
            const shortcodeMatch = url.match(/instagram\.com\/(p|reel|tv)\/([^/?#]+)/i);
            if (shortcodeMatch) {
                const type = shortcodeMatch[1].toLowerCase();
                const code = shortcodeMatch[2];
                return {
                    iframeUrl: `https://www.instagram.com/${type}/${code}/embed`,
                    message: '',
                    titleText: 'Instagram (embed)'
                };
            }
            return {
                iframeUrl: 'about:blank',
                message: 'Este link parece ser de PERFIL. O Instagram costuma bloquear a visualização embutida de perfis. Para ver dentro do site, cole o link de um post/reel específico. Caso contrário, use “Abrir no navegador”.',
                titleText: 'Instagram'
            };
        }

        // Sites: alguns bloqueiam iframe por segurança (X-Frame-Options). Ainda assim tentamos embutir.
        return {
            iframeUrl: url,
            message: 'Se o site não carregar aqui, provavelmente ele bloqueia visualização embutida. Use “Abrir no navegador”.',
            titleText: kind === 'site' ? 'Site' : 'Visualização'
        };
    }

    escapeHtmlAttr(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }

    escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    async geocodeAddress() {
        const input = document.getElementById('map-address');
        const latEl = document.getElementById('map-lat');
        const lngEl = document.getElementById('map-lng');
        if (!input || !latEl || !lngEl) return;

        const q = (input.value || '').trim();
        if (!q) {
            this.showNotification('Digite um endereço para buscar.');
            return;
        }

        try {
            const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(q)}`;
            const res = await fetch(url, {
                headers: {
                    'Accept': 'application/json'
                }
            });

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }

            const results = await res.json();
            if (!Array.isArray(results) || results.length === 0) {
                this.showNotification('Endereço não encontrado. Tente ser mais específico.');
                return;
            }

            const { lat, lon, display_name } = results[0];
            latEl.value = parseFloat(lat).toFixed(6);
            lngEl.value = parseFloat(lon).toFixed(6);
            this.showNotification('Endereço encontrado! Coordenadas preenchidas.');

            if (this.mapInstance) {
                this.mapInstance.setView([parseFloat(lat), parseFloat(lon)], 15);
                setTimeout(() => this.mapInstance.invalidateSize(), 0);
            }

            if (display_name && !input.value.includes(',')) {
                input.value = display_name;
            }
        } catch (err) {
            this.showNotification('Falha ao buscar endereço. Verifique sua internet e tente novamente.');
        }
    }

    formatDateBR(dateStr) {
        if (!dateStr) return '';
        try {
            return new Date(dateStr + 'T00:00:00').toLocaleDateString('pt-BR');
        } catch {
            return dateStr;
        }
    }

    getCategoryLabel(categoryKey) {
        return this.labels.categories[categoryKey] || this.capitalizeFirst(categoryKey);
    }

    getExpenseStatusLabel(statusKey) {
        return this.labels.expenseStatus[statusKey] || statusKey;
    }

    getTaskStatusLabel(statusKey) {
        return this.labels.taskStatus[statusKey] || statusKey;
    }

    getNoteTypeLabel(typeKey) {
        return this.labels.noteType[typeKey] || typeKey;
    }

    getChecklistCategoryLabel(categoryKey) {
        return this.labels.checklistCategory[categoryKey] || this.capitalizeFirst(categoryKey.replace('-', ' '));
    }

    // Utility functions
    formatCurrency(amount) {
        return new Intl.NumberFormat('pt-BR', {
            style: 'currency',
            currency: 'BRL'
        }).format(amount);
    }

    capitalizeFirst(str) {
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    formatMonth(monthString) {
        const date = new Date(monthString + '-01');
        return date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    }

    formatNoteContent(content) {
        // Convert bullet points and checkboxes
        return content
            .replace(/^\* /gm, '• ')
            .replace(/^\[ \] /gm, '☐ ')
            .replace(/^\[x\] /gm, '☑ ');
    }

    showNotification(message) {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = 'notification';
        notification.textContent = message;
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            background: #c8b8a3;
            color: white;
            padding: 1rem 1.5rem;
            border-radius: 4px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            z-index: 1000;
            animation: slideIn 0.3s ease;
        `;

        document.body.appendChild(notification);

        // Remove after 3 seconds
        setTimeout(() => {
            notification.style.animation = 'slideOut 0.3s ease';
            setTimeout(() => {
                document.body.removeChild(notification);
            }, 300);
        }, 3000);
    }
}

// Add notification animations
const style = document.createElement('style');
style.textContent = `
    @keyframes slideIn {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }

    @keyframes slideOut {
        from {
            transform: translateX(0);
            opacity: 1;
        }
        to {
            transform: translateX(100%);
            opacity: 0;
        }
    }
`;
document.head.appendChild(style);

// Initialize app
const app = new OurVowsApp();
