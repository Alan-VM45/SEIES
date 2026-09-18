// 1. CONFIGURACIÓN GLOBAL
const appConfig = window.SEIES_CONFIG;
const __firebase_config = appConfig?.firebase;
const __app_id = appConfig?.appId;
const __version = 'V56';
const ADMIN_EMAILS = appConfig?.adminEmails || [];

// Variables globales para almacenar datos en memoria
const renderedDais = {};
let reports = [], masterAlumnos = [], masterDais = [];
let db; // Instancia de Firestore
let currentUserEmail = null;
let currentTabs = []; // Pestañas de alumnos abiertas
let activeTabId = null; // ID de la pestaña que se está editando
let profileLoaded = false;
const closedTabIds = new Set();

function normalizeText(value) {
    return String(value || "").trim().replace(/\s+/g, " ").toUpperCase();
}

function normalizeTimestamp(value, fallbackId = "") {
    if (value && typeof value.toMillis === "function") return value.toMillis();
    const numericValue = Number(value);
    if (Number.isFinite(numericValue) && numericValue > 0) return numericValue;
    if (value) {
        const parsedValue = Date.parse(value);
        if (Number.isFinite(parsedValue)) return parsedValue;
    }

    // Los reportes antiguos guardaban el timestamp al final del ID.
    const idTimestamp = String(fallbackId).match(/(\d{13})$/)?.[1];
    return idTimestamp ? Number(idTimestamp) : 0;
}

function normalizeReport(data, id = "") {
    return {
        id,
        ...data,
        daiName: normalizeText(data.daiName || data.dai || data.nombreDai),
        studentName: normalizeText(data.studentName || data.alumno || data.nombreAlumno || data.student),
        school: normalizeText(data.school || data.escuela),
        grade: normalizeText(data.grade || data.grado || data.turno),
        reportText: data.reportText || data.detalle || data.detail || data.description || "",
        timestamp: normalizeTimestamp(data.timestamp || data.createdAt || data.fecha || 0, id)
    };
}

function findMasterStudent(studentName) {
    const normalizedName = normalizeText(studentName);
    return masterAlumnos.find(item => normalizeText(item.nombre || item.studentName || item.alumno) === normalizedName);
}

function hydrateActiveStudentData() {
    if (!activeTabId) return;

    const tab = currentTabs.find(item => item.id === activeTabId);
    const masterStudent = tab && findMasterStudent(tab.studentName);
    if (!tab || !masterStudent) return;

    tab.studentName = normalizeText(tab.studentName || masterStudent.nombre);
    tab.school = tab.school || masterStudent.school || "";
    tab.grade = tab.grade || masterStudent.grade || "";

    const schoolInput = document.getElementById('input-school');
    const gradeInput = document.getElementById('input-grade');
    if (schoolInput && !schoolInput.value) schoolInput.value = tab.school;
    if (gradeInput && !gradeInput.value) gradeInput.value = tab.grade;

    localStorage.setItem(`dai_tabs_${currentUserEmail}`, JSON.stringify(currentTabs));
    renderTabs();
}


// 2. INICIALIZACIÓN Y ACCESO A DATOS

// Obtiene la referencia raíz de la colección en Firestore para esta versión
function getDataRoot() {
    if (!db) {
        if (typeof firebase !== 'undefined' && firebase.apps.length) {
            db = firebase.firestore();
        } else {
            console.error("Base de datos no inicializada");
            throw new Error("Base de datos no inicializada. Reintenta en un momento.");
        }
    }
    return db.collection('artifacts').doc(__app_id).collection('public').doc('data');
}

// Inicializa Firebase y configura los escuchas de autenticación
function initializeApp() {
    console.log("Iniciando Sistema...");

    if (typeof firebase === 'undefined') {
        console.error("Error: Firebase no cargó.");
        return;
    }

    try {
        if (!firebase.apps.length) firebase.initializeApp(__firebase_config);
        db = firebase.firestore();
    } catch (e) {
        console.error("Error Firebase:", e);
    }

    if (typeof lucide !== 'undefined') lucide.createIcons();

    // Mostrar versión en la interfaz para depuración de caché
    const versionBadge = document.getElementById('version-badge');
    if (versionBadge) versionBadge.innerText = __version;

    firebase.auth().onAuthStateChanged(user => {
        const isLoginPage = window.location.pathname.endsWith('index.html') || window.location.pathname.endsWith('/');
        const mainNav = document.querySelector('nav');

        if (user) {
            currentUserEmail = user.email.toLowerCase();
            const esAdmin = ADMIN_EMAILS.includes(currentUserEmail);

            if (mainNav) mainNav.classList.remove('hidden');

            const inputDai = document.getElementById('input-daiName');
            const userDisplay = document.getElementById('user-display-name');
            const savedNameKey = `dai_saved_name_${currentUserEmail}`;
            const savedName = localStorage.getItem(savedNameKey);

            if (esAdmin) {
                if (inputDai) { inputDai.value = "COORDINACIÓN"; inputDai.readOnly = true; }
                if (userDisplay) userDisplay.innerText = "ADMINISTRADOR";
            } else {
                if (inputDai && savedName) inputDai.value = savedName;
                if (userDisplay) userDisplay.innerText = savedName || currentUserEmail.split('@')[0];
            }

            if (typeof actualizarInterfazPorRol === "function") actualizarInterfazPorRol(currentUserEmail);
            if (typeof subscribeData === "function") subscribeData();

            // Check for onboarding
            checkOnboarding(user);

            // Si está en index.html (login) pero ya está autenticado, redirigir a dashboard
            if (isLoginPage) {
                window.location.href = 'dashboard.html';
            }
        } else {
            currentUserEmail = null;
            if (mainNav) mainNav.classList.add('hidden');

            // Si NO está en index.html (login) y no hay usuario, redirigir a login (index.html)
            if (!isLoginPage) {
                window.location.href = 'index.html';
            }
        }
    });

    // Configura el guardado automático cuando se escribe en los campos de texto
    const triggerAutoSave = () => {
        if (!activeTabId) {
            const hasDraftInput = [
                document.getElementById('input-studentName').value,
                document.getElementById('input-school').value,
                document.getElementById('input-grade').value,
                document.getElementById('input-reportText').value
            ].some(value => value.trim());

            if (!hasDraftInput) return;

            const tabId = 'tab_' + Date.now();
            const newTab = {
                id: tabId,
                studentName: document.getElementById('input-studentName').value.trim().toUpperCase(),
                school: document.getElementById('input-school').value.trim().toUpperCase(),
                grade: document.getElementById('input-grade').value.trim().toUpperCase(),
                reportText: document.getElementById('input-reportText').value,
                lastUpdated: Date.now()
            };
            currentTabs.push(newTab);
            activeTabId = tabId;
            renderTabs();
            localStorage.setItem(`dai_active_tab_${currentUserEmail}`, tabId);
        }
        if (activeTabId) saveTabDraft(activeTabId);
    };

    const reportArea = document.getElementById('input-reportText');
    if (reportArea) {
        reportArea.addEventListener('input', triggerAutoSave);
    }

    ['input-studentName', 'input-school', 'input-grade'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', triggerAutoSave);
    });
}

// 3. AUTENTICACIÓN Y CONTROL DE ACCESO

// Procesa el inicio de sesión con Firebase
async function handleLogin() {
    const emailInput = document.getElementById('login-email').value;
    const pass = document.getElementById('login-password').value;
    const btn = document.getElementById('btn-do-login');

    // Normaliza el correo para evitar duplicados por minúsculas/mayúsculas
    const email = emailInput.trim().toLowerCase();

    if (!email || !pass) {
        showLoginError("Completa todos los campos");
        return;
    }

    try {
        btn.innerText = "CARGANDO...";
        btn.disabled = true;
        await firebase.auth().signInWithEmailAndPassword(email, pass);
    } catch (error) {
        console.error("Error de login:", error.code);
        showLoginError("Credenciales incorrectas");
    } finally {
        if (btn) {
            btn.innerText = "ENTRAR AL SISTEMA";
            btn.disabled = false;
        }
    }
}

// Cierra la sesión del usuario actual
function logout() {
    firebase.auth().signOut().then(() => {
        window.location.href = 'index.html';
    }).catch(err => {
        alert("Error al cerrar sesión");
    });
}

function showLoginError(text) {
    const errorMsg = document.getElementById('login-error');
    if (errorMsg) {
        errorMsg.innerText = text;
        errorMsg.classList.remove('hidden');
    }
}

// 4. SISTEMA DE NAVEGACIÓN ENTRE VISTAS

// Cambia la pestaña activa del dashboard (Carga, Coordinación, etc.)
function switchView(viewId) {
    const esAdmin = currentUserEmail && ADMIN_EMAILS.includes(currentUserEmail);
    if ((viewId === 'admin' || viewId === 'monthly') && !esAdmin) {
        viewId = 'dai';
    }

    // Oculta todas las vistas
    document.querySelectorAll('.view').forEach(view => {
        view.style.display = 'none';
        view.classList.remove('active');
    });

    // Muestra la vista seleccionada
    const target = document.getElementById('view-' + viewId);
    if (target) {
        target.style.display = 'block';
        target.classList.add('active');
        target.classList.remove('hidden');
    }

    // Actualiza el estilo visual de los botones de navegación
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('text-indigo-600', 'bg-white', 'shadow-sm');
        btn.classList.add('text-slate-500');
    });

    const activeBtn = document.getElementById('btn-' + viewId);
    if (activeBtn) activeBtn.classList.add('text-indigo-600', 'bg-white', 'shadow-sm');
}

// 5. GESTIÓN DE DATOS EN TIEMPO REAL (FIRESTORE)

// Se suscribe a las colecciones de Firestore para recibir actualizaciones automáticas
function subscribeData() {
    const root = getDataRoot();

    // Escucha cambios en la colección de reportes (V40 Master Sync Engine)
    root.collection('reports').onSnapshot(snap => {
        let tabsChanged = false;

        // FILTRO INTELIGENTE: Los reportes reales se actualizan por lote
        reports = snap.docs
            .map(doc => normalizeReport(doc.data(), doc.id))
            .filter(d => !d.isProfile && !d.isDraft);

        snap.docChanges().forEach(change => {
            const data = change.doc.data();
            const docId = change.doc.id;

            // 1. SINCRONIZACIÓN DE PERFIL
            if (data.isProfile && data.userEmail === currentUserEmail) {
                if (change.type === 'added' || change.type === 'modified') {
                    const userDisplay = document.getElementById('user-display-name');
                    if (userDisplay) userDisplay.innerText = data.name;
                    const inputDai = document.getElementById('input-daiName');
                    if (inputDai && !ADMIN_EMAILS.includes(currentUserEmail) && document.activeElement !== inputDai) {
                        inputDai.value = data.name;
                    }
                    localStorage.setItem(`dai_saved_name_${currentUserEmail}`, data.name);
                }
            }

            // 2. SINCRONIZACIÓN DE PESTAÑAS (Sync Granular V44)
            if (data.isDraft && data.userEmail === currentUserEmail) {
                if (closedTabIds.has(data.tabId)) return;

                // EXTERMINADOR DE ZOMBIES V44: Borramos formatos viejos O nombres placeholders
                const isPlaceholder = data.studentName === "NUEVO_ALUMNO" || data.studentName === "NUEVO ALUMNO";
                if (!docId.startsWith('DRAFT_') || isPlaceholder) {
                    console.warn("Limpiando zombie/placeholder V44:", docId);
                    root.collection('reports').doc(docId).delete();
                    return;
                }

                const localTab = currentTabs.find(t => t.id === data.tabId);

                if (change.type === 'removed') {
                    if (localTab) {
                        currentTabs = currentTabs.filter(t => t.id !== data.tabId);
                        tabsChanged = true;
                    }
                } else {
                    // Added or Modified
                    if (!localTab || (data.timestamp > (localTab.lastUpdated || 0))) {
                        const updated = {
                            id: data.tabId, studentName: data.studentName,
                            school: data.school, grade: data.grade,
                            reportText: data.reportText, lastUpdated: data.timestamp
                        };
                        if (!localTab) currentTabs.push(updated);
                        else Object.assign(localTab, updated);
                        tabsChanged = true;

                        // Actualizar UI solo si es la pestaña activa y NO hay foco en inputs
                        if (activeTabId === data.tabId && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
                            document.getElementById('input-studentName').value = updated.studentName || "";
                            document.getElementById('input-school').value = updated.school || "";
                            document.getElementById('input-grade').value = updated.grade || "";
                            document.getElementById('input-reportText').value = updated.reportText || "";
                        }
                    }
                }
            }
        });

        // Garantía de UX V41: Si no hay pestañas, permitir el estado vacío
        // No creamos automáticamente para evitar bucles con Firestore
        if (tabsChanged) {
            renderTabs();
            localStorage.setItem(`dai_tabs_${currentUserEmail}`, JSON.stringify(currentTabs));

            // Re-validar activeTabId
            if (activeTabId && !currentTabs.find(t => t.id === activeTabId)) {
                activeTabId = currentTabs.length > 0 ? currentTabs[0].id : null;
                if (activeTabId) switchTab(activeTabId);
                else clearReportForm();
            }
        }

        render();
        renderMonthly();

        // Renderizar historial del alumno en la pestaña activa
        if (activeTabId) {
            const currentSelected = currentTabs.find(t => t.id === activeTabId);
            if (currentSelected && typeof renderStudentHistory === 'function') {
                renderStudentHistory(currentSelected.studentName);
            }
        }
    }, err => {
        console.error("Error V40 Sync:", err);
        showNotification("No se pudo cargar la planilla. Revisa tu conexión o permisos.", "error");
    });

    // Escucha cambios en la lista maestra de alumnos
    root.collection('master_alumnos').onSnapshot(snap => {
        masterAlumnos = snap.docs.map(doc => {
            const data = doc.data();
            return {
                ...data,
                nombre: normalizeText(data.nombre || data.studentName || data.alumno),
                school: normalizeText(data.school || data.escuela),
                grade: normalizeText(data.grade || data.grado || data.turno)
            };
        });
        hydrateActiveStudentData();
    }, err => console.warn("Error en Alumnos:", err));

    // Escucha cambios en la lista maestra de DAIs
    root.collection('master_dais').onSnapshot(snap => {
        masterDais = snap.docs.map(doc => ({
            ...doc.data(),
            nombre: normalizeText(doc.data().nombre || doc.data().daiName || doc.data().dai)
        }));
    }, err => console.warn("Error en DAIs:", err));
}

// Guarda un reporte final y lo envía a la base de datos de Coordinación
async function saveReport() {
    const btn = document.getElementById('btn-save');
    const reportTextArea = document.getElementById('input-reportText');

    if (!reportTextArea) return;
    if (!activeTabId) {
        showNotification("No hay datos para enviar. Escriba algo primero.", "error");
        return;
    }

    // Obtiene los datos de la pestaña actual que se va a enviar
    const currentTab = currentTabs.find(t => t.id === activeTabId);
    if (!currentTab) return;

    const data = {
        daiName: document.getElementById('input-daiName')?.value.trim().toUpperCase() || "",
        studentName: document.getElementById('input-studentName')?.value.trim().toUpperCase() || "",
        school: document.getElementById('input-school')?.value.trim().toUpperCase() || "",
        grade: document.getElementById('input-grade')?.value.trim().toUpperCase() || "",
        reportText: reportTextArea.value,
        timestamp: Date.now(),
        userEmail: currentUserEmail
    };

    // Validación de campos obligatorios
    if (!data.daiName || !data.studentName || !data.reportText) {
        showNotification("Faltan datos obligatorios", "error");
        return;
    }

    const docId = `${data.daiName}_${data.studentName}_${data.timestamp}`.replace(/\s+/g, '_').toLowerCase();

    try {
        btn.disabled = true;
        btn.innerText = "GUARDANDO...";

        const root = getDataRoot();

        await root.collection('reports').doc(docId).set(data);

        try {
            await root.collection('master_alumnos').doc(data.studentName.replace(/\s+/g, '_')).set({
                nombre: data.studentName, school: data.school, grade: data.grade
            }, { merge: true });

            await root.collection('master_dais').doc(data.daiName.replace(/\s+/g, '_')).set({
                nombre: data.daiName
            }, { merge: true });
        } catch (masterErr) {
            console.warn("No se pudo actualizar master list (posible falta de permisos):", masterErr);
        }

        // NO eliminamos el borrador para que la pestaña no se cierre/borre sola (V46).
        // La DAI podrá cerrar la pestaña manualmente cuando lo desee.
        // const draftId = `DRAFT_${currentUserEmail}_${activeTabId}`.replace(/[@.]/g, '_');
        // await root.collection('reports').doc(draftId).delete();

        showNotification("¡Reporte Enviado!");
        renderTabs();
        if (typeof render === "function") render();

    } catch (err) {
        showNotification("Error al guardar: " + err.message, "error");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerText = "ENVIAR A COORDINACIÓN";
        }
    }
}

function renderStudentHistory(studentName) {
    const container = document.getElementById('student-history-container');
    const list = document.getElementById('student-history-list');
    const nameLabel = document.getElementById('student-history-name');

    if (!container || !list) return;

    if (!studentName || studentName === "NUEVO ALUMNO" || studentName === "NUEVO_ALUMNO") {
        container.classList.add('hidden');
        return;
    }

    const normalizedStudentName = normalizeText(studentName);
    const studentReports = reports.filter(r => normalizeText(r.studentName) === normalizedStudentName)
        .sort((a, b) => b.timestamp - a.timestamp);

    if (studentReports.length === 0) {
        container.classList.add('hidden');
        return;
    }

    nameLabel.innerText = normalizedStudentName;
    list.innerHTML = studentReports.map(r => {
        let formattedText = (r.reportText || "")
            .replace(/(LUNES|MARTES|MIÉRCOLES|JUEVES|VIERNES|SÁBADO|DOMINGO)([^:]*:)/gi, '<strong>$1$2</strong>')
            .replace(/\n/g, '<br>');
        formattedText = formattedText.replace(/\[OBSERVACIONES:(.*?)\]/gi, '<span class="text-red-600 font-bold uppercase block mt-2 border-l-4 border-red-600 pl-2 bg-red-50 p-2">OBSERVACIONES:$1</span>');

        const dateStr = new Date(r.timestamp).toLocaleDateString('es-AR', {
            day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });

        return `
            <div class="bg-slate-50 border border-slate-200 rounded-2xl p-4">
                <div class="flex justify-between items-center mb-2">
                    <span class="text-[10px] font-black uppercase text-indigo-600 tracking-widest">${dateStr}</span>
                </div>
                <div class="text-xs font-medium leading-relaxed whitespace-pre-wrap text-slate-700">${formattedText}</div>
            </div>
        `;
    }).join('');

    container.classList.remove('hidden');
}

// 6. UTILIDADES Y EXPORTACIÓN
function addToken(t) {
    const area = document.getElementById('input-reportText');
    if (area) { area.value += t; area.focus(); }
}

function handleSuggestion(type) {
    const input = document.getElementById(type === 'student' ? 'input-studentName' : 'input-daiName');
    const box = document.getElementById(`suggestions-${type}`);
    const val = input.value.toUpperCase().trim();

    if (val.length < 1) { box.classList.add('hidden'); return; }

    const list = type === 'student' ? masterAlumnos : masterDais;
    const filtered = list.filter(item => item.nombre.includes(val));

    if (filtered.length > 0) {
        box.innerHTML = filtered.map(item => `
            <div class="p-3 hover:bg-slate-100 cursor-pointer text-xs font-bold border-b border-slate-50" 
                 onclick="selectItem('${type}', '${item.nombre.replace(/'/g, "\\'")}')">
                ${item.nombre} ${type === 'student' ? `<span class="text-slate-400 font-normal">(${item.school})</span>` : ''}
            </div>
        `).join('');
        box.classList.remove('hidden');
    } else {
        box.classList.add('hidden');
    }
}

function selectItem(type, name) {
    if (type === 'student') {
        const item = masterAlumnos.find(a => a.nombre === name);
        document.getElementById('input-studentName').value = item.nombre;
        document.getElementById('input-school').value = item.school || "";
        document.getElementById('input-grade').value = item.grade || "";
        if (activeTabId) saveTabDraft(activeTabId);
        if (typeof renderStudentHistory === 'function') setTimeout(() => renderStudentHistory(item.nombre), 50);
    } else {
        document.getElementById('input-daiName').value = name;
    }
    document.querySelectorAll('[id^="suggestions-"]').forEach(b => b.classList.add('hidden'));
}

function processReportStats(reportText) {
    const text = (reportText || "").toUpperCase();
    const days = ["LUNES", "MARTES", "MIERCOLES", "MIÉRCOLES", "JUEVES", "VIERNES"];
    // pa: Presente Alumno, pd: Presente DAI
    const stats = { pa: 0, pd: 0, ad: 0, aa: 0, f: 0, fa: 0, nc: 0, totalHours: 0 };
    const attendanceMap = { LUNES: "-", MARTES: "-", MIERCOLES: "-", JUEVES: "-", VIERNES: "-" };

    days.forEach((day, i) => {
        if (text.includes(day)) {
            const startIdx = text.indexOf(day);

            // Buscar dónde empieza el siguiente día para limitar el snippet
            let nextDayIdx = text.length;
            days.forEach(otherDay => {
                const otherIdx = text.indexOf(otherDay, startIdx + day.length);
                if (otherIdx !== -1 && otherIdx < nextDayIdx) {
                    nextDayIdx = otherIdx;
                }
            });

            const snippet = text.substring(startIdx, nextDayIdx);

            // Cálculo de horas flexible
            // Formatos: 8 A 10, 8:30 A 10:30, 8.50, 13:30/15:30, 13:50 a 15:50
            const hourRegex = /(\d{1,2}(?:[:.]\d{2})?)\s*(?:A|\/|HS A)\s*(\d{1,2}(?:[:.]\d{2})?)/i;
            const singleHourRegex = /(\d{1,2}[:.]\d{2})/i;

            const match = snippet.match(hourRegex);
            if (match) {
                const parseH = (val) => {
                    const parts = val.replace('.', ':').split(':');
                    let h = parseFloat(parts[0]);
                    let m = parts[1] ? parseFloat(parts[1]) / 60 : 0;
                    return h + m;
                };
                const start = parseH(match[1]);
                const end = parseH(match[2]);
                if (!isNaN(start) && !isNaN(end) && end > start) {
                    stats.totalHours += (end - start);
                }
            } else {
                const singleMatch = snippet.match(singleHourRegex);
                if (singleMatch) {
                    // Si solo hay una hora, asumimos 1 hora de duración (ajustable según política)
                    stats.totalHours += 1;
                }
            }

            let status = "P"; // Presente por defecto
            if (snippet.includes("AUSENTE DAI")) status = "AD";
            else if (snippet.includes("AUSENTE ALUMNO")) status = "AA";
            else if (snippet.includes("AUSENTE POR ESCUELA") || snippet.includes("FERIADO")) status = "AE";
            else if (snippet.includes("FIRMA ACTA")) status = "FA";
            else if (snippet.includes("NO ASISTE POR CONVENIO")) status = "NC";

            // Lógica de conteo de presentes separada
            if (status === "P") {
                stats.pa++; // Alumno presente
                stats.pd++; // DAI presente
            } else if (status === "AD") {
                stats.pa++; // Alumno presente aunque no esté la DAI
                stats.ad++;
            } else if (status === "AA") {
                stats.pd++; // DAI presente aunque no esté el alumno
                stats.aa++;
            } else if (status === "FA") {
                stats.fa++;
            } else if (status === "NC") {
                stats.nc++;
            } else if (status === "AE") { // "Ausente Excusa"
                // No se cuenta como presente para DAI ni Alumno
            }

            const dayKey = day === "MIÉRCOLES" ? "MIERCOLES" : day;
            attendanceMap[dayKey] = status;
        }
    });
    return { stats, attendanceMap };
}

async function exportToExcel(customData = null) {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Asistencia');

    // Si hay datos personalizados, procesarlos primero
    if (customData) {
        processMonthlyGridForExcel(worksheet, customData);
    } else {
        const table = document.getElementById("monthly-table");
        if (!table) return alert("No se encontró la tabla");
        processTableForExcel(worksheet, table);
    }

    const buffer = await workbook.xlsx.writeBuffer();
    const fileName = customData ? `Asistencia_${customData.label}.xlsx` : "Asistencia.xlsx";
    saveAs(new Blob([buffer]), fileName);
}

function processTableForExcel(worksheet, table) {
    const colorMap = {
        "AD": { fill: 'FF0000', font: 'FFFFFF' },
        "AA": { fill: 'FFC000', font: '000000' },
        "AE": { fill: 'FFFF00', font: '000000' },
        "FA": { fill: '00B0F0', font: '000000' },
        "NC": { fill: 'D9D9D9', font: '000000' }
    };

    const mergedCells = new Set();
    const rows = Array.from(table.rows);
    rows.forEach((row, rowIndex) => {
        let excelColumnIndex = 1;
        Array.from(row.cells).forEach((cell) => {
            while (mergedCells.has(`${rowIndex + 1}-${excelColumnIndex}`)) { excelColumnIndex++; }
            const excelCell = worksheet.getCell(rowIndex + 1, excelColumnIndex);
            excelCell.value = cell.innerText.trim();
            excelCell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
            excelCell.alignment = { vertical: 'middle', horizontal: 'center' };

            const content = cell.innerText.trim();
            if (colorMap[content]) {
                excelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: colorMap[content].fill } };
                excelCell.font = { bold: true, color: { argb: colorMap[content].font } };
            }
            if (cell.tagName === 'TH' || rowIndex === 0) {
                excelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E0E0E0' } };
                excelCell.font = { bold: true };
            }

            const rowSpan = cell.rowSpan || 1;
            const colSpan = cell.colSpan || 1;
            if (rowSpan > 1 || colSpan > 1) {
                worksheet.mergeCells(rowIndex + 1, excelColumnIndex, rowIndex + rowSpan, excelColumnIndex + colSpan - 1);
                for (let r = 0; r < rowSpan; r++) {
                    for (let c = 0; c < colSpan; c++) {
                        mergedCells.add(`${rowIndex + r + 1}-${excelColumnIndex + c}`);
                    }
                }
            }
            excelColumnIndex += colSpan;
        });
    });
}

function processMonthlyGridForExcel(worksheet, data) {
    const months = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
    const now = new Date(data.startTime);
    const mName = months[now.getMonth()];
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

    // Crear encabezados similares al renderMonthly
    const headers = ['DAI', 'ALUMNO'];
    for (let i = 1; i <= daysInMonth; i++) headers.push(i.toString());
    headers.push('PA', 'PD', 'HS', 'OBSERVACIONES');

    const headerRow = worksheet.addRow(headers);
    headerRow.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'E0E0E0' } };
        cell.font = { bold: true };
        cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        cell.alignment = { horizontal: 'center' };
    });

    const daiNames = Object.keys(data.groups).sort();
    daiNames.forEach(dai => {
        const students = Object.values(data.groups[dai]);
        students.forEach((row, idx) => {
            const rowData = [idx === 0 ? dai : '', row.student];
            for (let i = 1; i <= daysInMonth; i++) rowData.push(row.days[i] || '');
            rowData.push(row.countPA, row.countPD, Number(row.totalHours.toFixed(2)), row.obs);

            const excelRow = worksheet.addRow(rowData);
            excelRow.eachCell((cell, colId) => {
                cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
                cell.alignment = { horizontal: 'center' };

                const val = cell.value;
                if (val === "AD") { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0000' } }; cell.font = { color: { argb: 'FFFFFF' } }; }
                else if (val === "AA") cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFC000' } };
                else if (val === "AE") cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF00' } };
                else if (val === "FA") cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '00B0F0' } };
                else if (val === "NC") cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'D9D9D9' } };
            });

            if (idx === 0 && students.length > 1) {
                worksheet.mergeCells(excelRow.number, 1, excelRow.number + students.length - 1, 1);
            }
        });
    });
}

function render() {
    const adminBody = document.getElementById('table-admin-body');
    if (!adminBody) return;

    // Obtener el inicio de la semana actual (Lunes 00:00:00)
    const now = new Date();
    const mondayDate = new Date(now);
    const dayOfWeek = mondayDate.getDay(); // 0: Dom, 1: Lun, ...
    const diff = (dayOfWeek === 0 ? -6 : 1) - dayOfWeek;
    mondayDate.setDate(mondayDate.getDate() + diff);
    mondayDate.setHours(0, 0, 0, 0);

    // Obtener el inicio del mes actual
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);

    // Usar el lunes como inicio para la vista semanal de Coordinación (Fix V51: No filtrar por cambio de mes)
    const startTimestamp = mondayDate.getTime();

    const groups = {};
    // Filtrar solo los reportes de la semana actual para Coordinación
    reports.filter(r => r.timestamp >= startTimestamp).forEach(r => {
        if (!groups[r.daiName]) groups[r.daiName] = [];
        groups[r.daiName].push(r);
    });
    let adminHtml = "";
    const dais = Object.keys(groups).sort();
    dais.forEach(dai => {
        const alumnos = groups[dai];
        alumnos.forEach((r, idx) => {
            let formattedText = (r.reportText || "")
                .replace(/(LUNES|MARTES|MIÉRCOLES|JUEVES|VIERNES|SÁBADO|DOMINGO)([^:]*:)/gi, '<strong>$1$2</strong>')
                .replace(/\n/g, '<br>');

            // Resaltar observaciones en rojo
            formattedText = formattedText.replace(/\[OBSERVACIONES:(.*?)\]/gi, '<span class="text-red-600 font-bold uppercase block mt-2 border-l-4 border-red-600 pl-2 bg-red-50 p-2">OBSERVACIONES:$1</span>');

            adminHtml += `
                <tr class="hover:bg-slate-50">
                    ${idx === 0 ? `<td rowspan="${alumnos.length}" class="border-2 border-black p-4 uppercase font-black bg-slate-100 text-indigo-700 align-middle text-center text-sm">${dai}</td>` : ''}
                    <td class="border-2 border-black p-4 uppercase font-bold text-xs text-center">${r.studentName}<div class="text-[9px] text-slate-400 font-normal mt-1 italic">${r.school} - ${r.grade}</div></td>
                    <td class="border-2 border-black p-4 text-xs font-medium leading-relaxed whitespace-pre-wrap">${formattedText}</td>
                    <td class="border-2 border-black p-2 text-center no-print"><button onclick="triggerDeleteReport('${r.id}')" class="text-red-400 hover:text-red-600 font-black">X</button></td>
                </tr>`;
        });
    });
    adminBody.innerHTML = adminHtml || "<tr><td colspan='4' class='p-8 text-center uppercase font-bold text-slate-400'>No hay reportes esta semana</td></tr>";

    // Renderizar Archivo de Semanas Anteriores
    renderArchives();
}

function getWeekRangeLabel(timestamp) {
    const d = new Date(timestamp);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff));
    const friday = new Date(monday);
    friday.setDate(monday.getDate() + 4);

    const months = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];
    return `${monday.getDate()} al ${friday.getDate()} de ${months[monday.getMonth()]}`;
}

function renderArchives() {
    const now = new Date();
    // Inicio de la semana actual
    const currentMonday = new Date(now);
    const day = currentMonday.getDay();
    currentMonday.setDate(currentMonday.getDate() + (day === 0 ? -6 : 1) - day);
    currentMonday.setHours(0, 0, 0, 0);

    // Inicio del mes actual
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);

    // Agrupar SEMANAS
    const weeklyGroups = {};
    reports.forEach(r => {
        const d = new Date(r.timestamp);
        const mon = new Date(d);
        const day = mon.getDay();
        mon.setDate(mon.getDate() + (day === 0 ? -6 : 1) - day);
        mon.setHours(0, 0, 0, 0);

        if (mon.getTime() < currentMonday.getTime()) {
            const key = mon.getTime();
            if (!weeklyGroups[key]) weeklyGroups[key] = [];
            weeklyGroups[key].push(r);
        }
    });

    const adminArchives = document.getElementById('admin-archives');
    if (adminArchives) {
        const sortedWeeks = Object.keys(weeklyGroups).sort((a, b) => b - a);
        adminArchives.innerHTML = sortedWeeks.map(key => {
            const label = getWeekRangeLabel(parseInt(key));
            return `
                <div class="bg-slate-50 p-4 rounded-2xl border border-slate-200 flex justify-between items-center group hover:bg-white hover:shadow-md transition-all">
                    <div>
                        <div class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Semana del</div>
                        <div class="text-xs font-black uppercase text-slate-700">${label}</div>
                    </div>
                    <button onclick="downloadWordArchive(${key})" class="bg-indigo-600 text-white p-3 rounded-xl hover:scale-105 transition-all shadow-indigo-100 shadow-lg">
                        <i data-lucide="file-down" class="w-4 h-4"></i>
                    </button>
                </div>
            `;
        }).join('');
    }

    // Agrupar MESES
    const monthlyGroups = {};
    reports.forEach(r => {
        const d = new Date(r.timestamp);
        const monthStart = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);

        if (monthStart.getTime() < currentMonthStart.getTime()) {
            const key = monthStart.getTime();
            if (!monthlyGroups[key]) monthlyGroups[key] = { label: "", reports: [] };
            monthlyGroups[key].reports.push(r);
            const months = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
            monthlyGroups[key].label = `${months[d.getMonth()]} ${d.getFullYear()}`;
        }
    });

    const monthlyArchives = document.getElementById('monthly-archives');
    if (monthlyArchives) {
        const sortedMonths = Object.keys(monthlyGroups).sort((a, b) => b - a);
        monthlyArchives.innerHTML = sortedMonths.map(key => {
            const label = monthlyGroups[key].label;
            return `
                <div class="bg-slate-50 p-4 rounded-2xl border border-slate-200 flex justify-between items-center group hover:bg-white hover:shadow-md transition-all">
                    <div>
                        <div class="text-[10px] font-black text-slate-400 uppercase tracking-widest">Planilla de</div>
                        <div class="text-xs font-black uppercase text-slate-700">${label}</div>
                    </div>
                    <button onclick="downloadMonthlyArchive(${key})" class="bg-green-600 text-white p-3 rounded-xl hover:scale-105 transition-all shadow-green-100 shadow-lg">
                        <i data-lucide="file-spreadsheet" class="w-4 h-4"></i>
                    </button>
                </div>
            `;
        }).join('');
    }

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function downloadWordArchive(timestamp) {
    const mon = new Date(timestamp);
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 7);

    const filtered = reports.filter(r => r.timestamp >= mon.getTime() && r.timestamp < sun.getTime());
    const label = getWeekRangeLabel(timestamp);
    downloadWord(filtered, label);
}

function downloadMonthlyArchive(timestamp) {
    const start = new Date(timestamp);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    const filtered = reports.filter(r => r.timestamp >= start.getTime() && r.timestamp < end.getTime());

    const months = ["ENERO", "FEBRERO", "MARZO", "ABRIL", "MAYO", "JUNIO", "JULIO", "AGOSTO", "SEPTIEMBRE", "OCTUBRE", "NOVIEMBRE", "DICIEMBRE"];
    const label = `${months[start.getMonth()]}_${start.getFullYear()}`;

    // Necesitamos procesar los datos para la grilla
    const daiGroups = {};
    filtered.forEach(r => {
        if (!daiGroups[r.daiName]) daiGroups[r.daiName] = {};
        if (!daiGroups[r.daiName][r.studentName]) daiGroups[r.daiName][r.studentName] = { student: r.studentName, days: {}, obs: "", totalHours: 0, countPA: 0, countPD: 0 };
        const fechaReporte = new Date(r.timestamp);
        const resultado = processReportStats(r.reportText);
        daiGroups[r.daiName][r.studentName].totalHours += (resultado.stats.totalHours || 0);
        daiGroups[r.daiName][r.studentName].countPA += (resultado.stats.pa || 0);
        daiGroups[r.daiName][r.studentName].countPD += (resultado.stats.pd || 0);
        const dayMap = { "LUNES": 1, "MARTES": 2, "MIERCOLES": 3, "JUEVES": 4, "VIERNES": 5 };
        Object.keys(resultado.attendanceMap).forEach(dayName => {
            const estado = resultado.attendanceMap[dayName];
            if (estado !== "-") {
                const d = new Date(fechaReporte);
                const diff = d.getDate() - d.getDay() + dayMap[dayName];
                const actualDate = new Date(d.setDate(diff));
                if (actualDate.getMonth() === fechaReporte.getMonth()) daiGroups[r.daiName][r.studentName].days[actualDate.getDate()] = estado;
            }
        });
    });

    exportToExcel({ groups: daiGroups, label, startTime: timestamp });
}

function renderMonthly() {
    const thead = document.getElementById('monthly-thead');
    const tbody = document.getElementById('monthly-tbody');
    if (!thead || !tbody) return;
    const significados = { "P": "Presente", "AD": "Ausencia DAI", "AA": "Ausencia Alumno", "AE": "Ausente Excusa", "FA": "Feriado/Acta", "NC": "No corresponde" };

    // Obtener días del mes dinámicamente y filtrar reportes del mes actual
    const now = new Date();
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).getTime();

    let headerHTML = `<tr><th class="border-2 border-black p-1 text-left bg-gray-200 text-[10px]">DAI</th><th class="border-2 border-black p-1 text-left bg-gray-200 text-[10px]">ALUMNO</th>`;
    for (let i = 1; i <= daysInMonth; i++) headerHTML += `<th class="border border-black p-1 text-center w-8 text-[10px] bg-white">${i}</th>`;
    headerHTML += `<th class="border-2 border-black p-1 text-center bg-gray-200 text-[10px]" title="Presente Alumno">PA</th><th class="border-2 border-black p-1 text-center bg-gray-200 text-[10px]" title="Presente DAI">PD</th><th class="border-2 border-black p-1 text-center bg-gray-200 text-[10px]">HS</th><th class="border-2 border-black p-1 text-left bg-gray-200 text-[10px]">OBSERVACIONES</th></tr>`;
    thead.innerHTML = headerHTML;

    const daiGroups = {};
    // Filtrar solo los reportes del mes actual
    reports.filter(r => r.timestamp >= monthStart).forEach(r => {
        if (!daiGroups[r.daiName]) daiGroups[r.daiName] = {};
        if (!daiGroups[r.daiName][r.studentName]) daiGroups[r.daiName][r.studentName] = { student: r.studentName, days: {}, obs: "", totalHours: 0, countPA: 0, countPD: 0 };
        const fechaReporte = new Date(r.timestamp);
        const resultado = processReportStats(r.reportText);

        // Sumar horas y presentes
        daiGroups[r.daiName][r.studentName].totalHours += (resultado.stats.totalHours || 0);
        daiGroups[r.daiName][r.studentName].countPA += (resultado.stats.pa || 0);
        daiGroups[r.daiName][r.studentName].countPD += (resultado.stats.pd || 0);

        const dayMap = { "LUNES": 1, "MARTES": 2, "MIERCOLES": 3, "JUEVES": 4, "VIERNES": 5 };
        Object.keys(resultado.attendanceMap).forEach(dayName => {
            const estado = resultado.attendanceMap[dayName];
            if (estado !== "-") {
                const d = new Date(fechaReporte);
                const diff = d.getDate() - d.getDay() + dayMap[dayName];
                const actualDate = new Date(d.setDate(diff));
                if (actualDate.getMonth() === fechaReporte.getMonth()) daiGroups[r.daiName][r.studentName].days[actualDate.getDate()] = estado;
            }
        });
    });

    let bodyHTML = '';
    Object.keys(daiGroups).forEach(daiName => {
        const students = Object.values(daiGroups[daiName]);
        students.forEach((row, index) => {
            let countP = 0, dayCells = '';
            for (let i = 1; i <= daysInMonth; i++) {
                const estado = row.days[i] || '';
                let bgColor = "", textColor = "text-black", tooltip = significados[estado] || "";
                switch (estado) {
                    case "P": countP++; bgColor = "bg-white"; break;
                    case "NC": bgColor = "bg-[#d1d5db]"; break;
                    case "FA": bgColor = "bg-[#4db8c1]"; break;
                    case "AE": bgColor = "bg-[#ffff00]"; break;
                    case "AA": bgColor = "bg-[#fbc02d]"; break;
                    case "AD": bgColor = "bg-[#ff0000]"; textColor = "text-white"; break;
                }
                dayCells += `<td title="${tooltip}" class="border border-black text-center p-0 text-[10px] font-black h-7 ${bgColor} ${textColor}">${estado}</td>`;
            }
            bodyHTML += `<tr class="hover:bg-gray-50">${index === 0 ? `<td rowspan="${students.length}" class="border-2 border-black p-1 font-bold text-[10px] uppercase align-middle bg-white text-center">${daiName}</td>` : ''}
                <td class="border-2 border-black p-1 text-[10px] uppercase">${row.student}</td>${dayCells}<td class="border-2 border-black text-center font-black p-1 bg-slate-100">${row.countPA}</td>
                <td class="border-2 border-black text-center font-black p-1 bg-amber-50 text-amber-600">${row.countPD}</td>
                <td class="border-2 border-black text-center font-black p-1 bg-indigo-50 text-indigo-700">${Number(row.totalHours.toFixed(2))}</td>
                <td class="border-2 border-black p-1 text-[8px] uppercase">${row.obs}</td></tr>`;
        });
    });
    tbody.innerHTML = bodyHTML;
}

function downloadWord(customData = null, customLabel = null) {
    const table = document.getElementById('table-to-export');
    if (!table && !customData) return;

    const style = `<style>table { border-collapse: collapse; width: 100%; } th, td { border: 1px solid black; padding: 8px; font-family: sans-serif; font-size: 10pt; vertical-align: middle; } th { background-color: #f3f4f6; text-align: center; }</style>`;
    const header = "<html><head><meta charset='utf-8'>" + style + "</head><body>";

    let tableHTML = "";
    if (customData) {
        const groups = {};
        customData.forEach(r => {
            if (!groups[r.daiName]) groups[r.daiName] = [];
            groups[r.daiName].push(r);
        });

        tableHTML = `<table><thead><tr><th>DAI</th><th>ALUMNO</th><th>DETALLE SEMANAL</th></tr></thead><tbody>`;
        Object.keys(groups).sort().forEach(dai => {
            const alumnos = groups[dai];
            alumnos.forEach((r, idx) => {
                const text = (r.reportText || "").replace(/\n/g, '<br>');
                tableHTML += `<tr>${idx === 0 ? `<td rowspan="${alumnos.length}">${dai}</td>` : ''}<td>${r.studentName} (${r.school})</td><td>${text}</td></tr>`;
            });
        });
        tableHTML += `</tbody></table>`;
    } else {
        const tempTable = table.cloneNode(true);
        tempTable.querySelectorAll('.no-print').forEach(el => el.remove());
        tableHTML = tempTable.outerHTML;
    }

    const sourceHTML = header + tableHTML + "</body></html>";
    const fileName = customLabel ? `Reporte_${customLabel}.doc` : 'Planilla_Coordinacion.doc';
    saveAs(new Blob(['\ufeff', sourceHTML], { type: 'application/msword' }), fileName);
}

async function deleteReport(id) {
    // Función original de Firebase que sigue existiendo pero ya no se llama directamente con confirm()
    try {
        await db.collection('artifacts').doc(__app_id).collection('public').doc('data').collection('reports').doc(id).delete();
        showNotification("Reporte eliminado");
        closeDeleteModal();
    } catch (e) {
        showNotification("Error al eliminar", "error");
    }
}

function triggerDeleteReport(id) {
    const modal = document.getElementById('modal-delete');
    const input = document.getElementById('delete-report-id');
    if (modal && input) {
        input.value = id;
        modal.classList.add('active');
    }
}

function closeDeleteModal() {
    const modal = document.getElementById('modal-delete');
    if (modal) modal.classList.remove('active');
}

function confirmDeleteReport() {
    const id = document.getElementById('delete-report-id').value;
    if (id) deleteReport(id);
}

// 7. NOTIFICACIONES Y GESTIÓN DE PERFIL

// Muestra un mensaje temporal (toast) en la pantalla
function showNotification(message, type = "success") {
    const container = document.getElementById('toast-container');
    if (!container) return;

    // Crear el elemento de la notificación
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    if (type === 'error') toast.style.backgroundColor = '#ef4444';

    toast.innerHTML = `
        <i data-lucide="${type === 'success' ? 'check-circle' : 'alert-circle'}" class="w-5 h-5"></i>
        <span>${message}</span>
    `;

    container.appendChild(toast);
    if (typeof lucide !== 'undefined') lucide.createIcons();

    // Animación de entrada
    setTimeout(() => toast.classList.add('show'), 10);

    // Animación de salida y eliminación (después de 3 segundos)
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// Verifica y sincroniza el perfil del usuario en tiempo real
async function checkOnboarding(user) {
    if (!user) return;
    const email = user.email.toLowerCase();

    try {
        const root = getDataRoot();

        // Listener en tiempo real para el perfil del usuario
        // Usamos una colección 'user_profiles' dentro del root versionado para asegurar permisos
        root.collection('user_profiles').doc(email).onSnapshot(doc => {
            const profile = doc.data();
            if (profile && profile.name) {
                profileLoaded = true;
                const userDisplay = document.getElementById('user-display-name');
                if (userDisplay) userDisplay.innerText = profile.name;

                const savedNameKey = `dai_saved_name_${email}`;
                localStorage.setItem(savedNameKey, profile.name);

                const inputDai = document.getElementById('input-daiName');
                if (inputDai) {
                    inputDai.value = profile.name;
                    if (ADMIN_EMAILS.includes(email)) {
                        inputDai.value = "COORDINACIÓN";
                        inputDai.readOnly = true;
                    }
                }
            }
        }, err => {
            console.error("Error en tiempo real de perfil:", err);
            // Fallback a localStorage si hay error de permisos o red
            const savedName = localStorage.getItem(`dai_saved_name_${email}`);
            const userDisplay = document.getElementById('user-display-name');
            if (savedName && userDisplay) userDisplay.innerText = savedName;
        });

        // Iniciamos la carga de de pestañas
        loadTabsFromFirestore();
        switchView('dai');

    } catch (e) {
        console.error("Error inicializando onboarding:", e);
        loadTabsFromFirestore();
        switchView('dai');
    }
}

function openProfileModal(isOnboarding = false) {
    const modal = document.getElementById('modal-profile');
    const input = document.getElementById('profile-name');
    const cancelBtn = document.getElementById('btn-cancel-profile');

    if (modal && input) {
        modal.classList.add('active');
        input.focus();
        if (isOnboarding && cancelBtn) {
            cancelBtn.classList.add('hidden');
        } else if (cancelBtn) {
            cancelBtn.classList.remove('hidden');
        }
    }
}

function closeProfileModal() {
    const modal = document.getElementById('modal-profile');
    if (modal) modal.classList.remove('active');
}

function saveProfileName(e) {
    if (e && e.preventDefault) e.preventDefault();
    const btn = e ? (e.currentTarget || e.target) : null;
    const input = document.getElementById('profile-name');

    if (!input) {
        showNotification("Error de interfaz", "error");
        return;
    }

    const newName = input.value.trim().toUpperCase();

    if (!newName) {
        showNotification("Ingresa un nombre válido", "error");
        return;
    }

    // Asegurar correo
    const email = (currentUserEmail || (firebase.auth().currentUser ? firebase.auth().currentUser.email : null) || "").toLowerCase();

    if (!email) {
        showNotification("No se detectó sesión activa. Reintenta loguearte.", "error");
        return;
    }

    (async () => {
        try {
            const root = getDataRoot();
            // PROTOCOLO MIMICRY (V39): El perfil DEBE parecer un reporte para que Firebase lo acepte
            const docId = `CONFIG_PROFILE_${email}`.replace(/[@.]/g, '_');
            await root.collection('reports').doc(docId).set({
                isProfile: true,
                name: newName,
                daiName: newName,
                studentName: "SISTEMA_PERFIL",
                school: "SEIES",
                grade: "CONFIG",
                reportText: "CONFIGURACION_DE_PERFIL",
                userEmail: email,
                timestamp: Date.now()
            }, { merge: true });

            showNotification("Perfil actualizado");
            closeProfileModal();

            if (!profileLoaded) {
                profileLoaded = true;
                loadTabsFromFirestore();
                switchView('dai');
            }
        } catch (err) {
            console.error("Error saving profile:", err);
            showNotification("Error al guardar: " + err.message, "error");
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerText = "GUARDAR";
            }
        }
    })();
}

// 8. GESTIÓN DE PESTAÑAS (TABS) DE ALUMNOS

// 8. GESTIÓN DE PESTAÑAS (TABS) DE ALUMNOS

// Carga las pestañas guardadas (borradores) desde Firestore y localStorage
async function loadTabsFromFirestore() {
    // Asegurar que tenemos el email del usuario para las rutas de guardado
    const email = (currentUserEmail || (firebase.auth().currentUser ? firebase.auth().currentUser.email : null) || "").toLowerCase();
    if (!email) return;
    currentUserEmail = email; // Sincroniza la variable global

    // Intento de carga local inmediata para una respuesta rápida en la interfaz (UX)
    const localTabs = localStorage.getItem(`dai_tabs_${currentUserEmail}`);
    const localActive = localStorage.getItem(`dai_active_tab_${currentUserEmail}`);
    const savedClosedTabs = JSON.parse(localStorage.getItem(`dai_closed_tabs_${currentUserEmail}`) || '[]');
    savedClosedTabs.forEach(tabId => closedTabIds.add(tabId));

    if (localTabs) {
        const savedTabs = JSON.parse(localTabs);
        currentTabs = savedTabs.filter(tab => [
            tab.studentName,
            tab.school,
            tab.grade,
            tab.reportText
        ].some(value => String(value || '').trim()) && !closedTabIds.has(tab.id));
        activeTabId = localActive;
        localStorage.setItem(`dai_tabs_${currentUserEmail}`, JSON.stringify(currentTabs));
        renderTabs();
        if (activeTabId) switchTab(activeTabId);
        else if (currentTabs.length > 0) switchTab(currentTabs[0].id);
    }

    // En V39+, subscribeData maneja la carga desde Firestore
    console.log("Carga inicial lista. Esperando sync...");
}

// Crea una nueva pestaña de alumno en blanco
function addNewStudentTab() {
    const tabId = 'tab_' + Date.now();
    const newTab = {
        id: tabId,
        studentName: "",
        school: "",
        grade: "",
        reportText: "",
        lastUpdated: Date.now()
    };
    currentTabs.push(newTab);
    renderTabs();
    switchTab(tabId);
    saveTabDraft(tabId);
}

// Dibuja las pestañas de alumnos en la parte superior del formulario
function renderTabs() {
    const container = document.getElementById('tabs-container');
    if (!container) return;

    const plusBtn = container.querySelector('button[onclick="addNewStudentTab()"]');

    let html = "";
    currentTabs.forEach(tab => {
        const displayName = tab.studentName || "NUEVO ALUMNO";
        const activeClass = tab.id === activeTabId ? 'active' : 'inactive';
        html += `
            <div id="${tab.id}" class="student-tab ${activeClass}" onclick="switchTab('${tab.id}')">
                <span>${displayName}</span>
                <i data-lucide="x" class="w-3 h-3 hover:text-red-500 cursor-pointer ml-2" onclick="event.stopPropagation(); removeTab('${tab.id}')"></i>
            </div>
        `;
    });

    container.innerHTML = html || `<div class="p-2 text-[10px] text-slate-400 font-bold uppercase">No hay alumnos. Presiona (+) para empezar</div>`;
    if (plusBtn) container.appendChild(plusBtn);
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function clearReportForm() {
    activeTabId = null;
    localStorage.removeItem(`dai_active_tab_${currentUserEmail}`);
    currentTabs.forEach(t => {
        const el = document.getElementById(t.id);
        if (el) el.classList.remove('active');
    });
    document.getElementById('input-studentName').value = "";
    document.getElementById('input-school').value = "";
    document.getElementById('input-grade').value = "";
    document.getElementById('input-reportText').value = "";
    document.getElementById('report-title').innerText = "Carga de Reporte";

    if (typeof renderStudentHistory === 'function') {
        renderStudentHistory("");
    }

    renderTabs();
}

// Cambia entre las pestañas de alumnos
function switchTab(tabId) {
    // Guarda el contenido actual antes de cambiar a otra pestaña para no perder datos
    if (activeTabId && activeTabId !== tabId) {
        const currentTab = currentTabs.find(t => t.id === activeTabId);
        if (currentTab) {
            currentTab.studentName = document.getElementById('input-studentName').value.trim().toUpperCase();
            currentTab.school = document.getElementById('input-school').value.trim().toUpperCase();
            currentTab.grade = document.getElementById('input-grade').value.trim().toUpperCase();
            currentTab.reportText = document.getElementById('input-reportText').value;
        }
    }

    activeTabId = tabId;
    localStorage.setItem(`dai_active_tab_${currentUserEmail}`, tabId);

    const tab = currentTabs.find(t => t.id === tabId);
    if (!tab) return;

    // Actualiza los campos del formulario con los datos de la nueva pestaña seleccionada
    document.getElementById('input-studentName').value = tab.studentName || "";
    document.getElementById('input-school').value = tab.school || "";
    document.getElementById('input-grade').value = tab.grade || "";
    document.getElementById('input-reportText').value = tab.reportText || "";
    document.getElementById('report-title').innerText = tab.studentName ? `Reporte: ${tab.studentName}` : "Nuevo Reporte Semanal";

    if (typeof renderStudentHistory === 'function') {
        renderStudentHistory(tab.studentName || "");
    }

    renderTabs();
}

// Muestra el modal de confirmación para cerrar una pestaña (V44: Incluso la última)
function removeTab(tabId) {

    const modal = document.getElementById('modal-tab-delete');
    const input = document.getElementById('delete-tab-id');
    if (modal && input) {
        input.value = tabId;
        modal.classList.add('active');
    }
}

// Cierra cualquier modal abierto (de perfil o de borrado de pestaña)
function closeTabDeleteModal() {
    const modal = document.getElementById('modal-tab-delete');
    if (modal) modal.classList.remove('active');
}

// Ejecuta la eliminación definitiva de una pestaña tanto localmente como en Firestore
async function confirmRemoveTab() {
    const tabId = document.getElementById('delete-tab-id').value;
    if (!tabId) return;

    closedTabIds.add(tabId);
    localStorage.setItem(`dai_closed_tabs_${currentUserEmail}`, JSON.stringify([...closedTabIds]));

    // Actualiza la interfaz inmediatamente (Optimistic UI)
    currentTabs = currentTabs.filter(t => t.id !== tabId);
    if (activeTabId === tabId) {
        activeTabId = currentTabs.length > 0 ? currentTabs[0].id : null;
    }
    closeTabDeleteModal();
    renderTabs();
    if (activeTabId) switchTab(activeTabId);
    else clearReportForm();

    // Persistencia: Guardar cambios localmente
    localStorage.setItem(`dai_tabs_${currentUserEmail}`, JSON.stringify(currentTabs));

    try {
        const root = getDataRoot();
        const docId = `DRAFT_${currentUserEmail}_${tabId}`.replace(/[@.]/g, '_');
        await root.collection('reports').doc(docId).delete();
    } catch (e) {
        console.error("Error eliminando pestaña de Firestore (V39):", e);
    }
}

// Guarda un borrador de la pestaña actual en el almacenamiento local y en la nube (Firestore)
async function saveTabDraft(tabId) {
    const email = (currentUserEmail || (firebase.auth().currentUser ? firebase.auth().currentUser.email : null) || "").toLowerCase();
    if (!email || closedTabIds.has(tabId)) return;
    currentUserEmail = email;

    const tab = currentTabs.find(t => t.id === tabId);
    if (!tab) return;

    // Si es la pestaña activa, actualiza el objeto tab con lo que hay escrito en los inputs
    if (tabId === activeTabId) {
        tab.studentName = document.getElementById('input-studentName').value.trim().toUpperCase();
        tab.school = document.getElementById('input-school').value.trim().toUpperCase();
        tab.grade = document.getElementById('input-grade').value.trim().toUpperCase();
        tab.reportText = document.getElementById('input-reportText').value;

        // Actualizar título visualmente sin re-renderizar todo
        const tabEl = document.querySelector(`.student-tab#${tabId} span`);
        if (tabEl) tabEl.innerText = tab.studentName || "NUEVO ALUMNO";
        document.getElementById('report-title').innerText = tab.studentName ? `Reporte: ${tab.studentName}` : "Nuevo Reporte Semanal";
    }

    tab.lastUpdated = Date.now();

    // Guardado local inmediato para que no se pierda nada si se cierra el navegador
    localStorage.setItem(`dai_tabs_${currentUserEmail}`, JSON.stringify(currentTabs));

    // V43: NO GUARDAR EN FIRESTORE SI ESTÁ VACÍO
    // Solo sincronizar si tiene al menos un nombre de alumno o algo de texto
    const shouldSync = tab.studentName && tab.studentName !== "NUEVO_ALUMNO";

    if (!shouldSync) {
        console.log("Pestaña vacía, solo guardado local");
        return;
    }

    try {
        const root = getDataRoot();
        const docId = `DRAFT_${currentUserEmail}_${tabId}`.replace(/[@.]/g, '_');

        if (closedTabIds.has(tabId)) return;

        await root.collection('reports').doc(docId).set({
            ...tab,
            isDraft: true,
            userEmail: currentUserEmail,
            daiName: (document.getElementById('input-daiName')?.value || "USUARIO"),
            studentName: tab.studentName,
            school: tab.school || "",
            grade: tab.grade || "",
            reportText: tab.reportText || "",
            tabId: tabId,
            timestamp: Date.now()
        }, { merge: true });

        // Muestra el pequeño mensaje de "Sincronizado"
        const syncMsg = document.getElementById('sync-msg');
        if (syncMsg) {
            syncMsg.classList.remove('hidden');
            setTimeout(() => syncMsg.classList.add('hidden'), 2000);
        }
    } catch (e) {
        console.error("Error guardando borrador en Firebase (V38):", e);
    }
}

// Función que se activa manualmente con el botón "GUARDAR PROGRESO"
async function saveCurrentProgress() {
    const btn = document.getElementById('btn-save-draft');
    if (!activeTabId) {
        showNotification("No hay ningún reporte en progreso para guardar", "error");
        return;
    }

    try {
        if (btn) {
            btn.disabled = true;
            btn.innerText = "GUARDANDO...";
        }
        await saveTabDraft(activeTabId);
        showNotification("Progreso guardado correctamente");
    } catch (err) {
        showNotification("Error al guardar progreso: " + err.message, "error");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerText = "GUARDAR PROGRESO";
        }
    }
}

// Funciones para abrir el modal de perfil
function configurarPerfil() { openProfileModal(); }
function openSettings() { openProfileModal(); }

// Oculta o muestra botones del menú según si el usuario es Administrador o DAI
function actualizarInterfazPorRol(email) {
    const esAdmin = ADMIN_EMAILS.includes(email);
    ['btn-admin', 'btn-stats', 'btn-monthly'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('hidden', !esAdmin);
    });

    // El botón MI PERFIL y CARGA están siempre visibles para las DAIs
    const btnDai = document.getElementById('btn-dai');
    if (btnDai) btnDai.classList.remove('hidden');

    const btnProfile = document.getElementById('btn-profile');
    if (btnProfile) btnProfile.classList.remove('hidden');
}

// Inicia la aplicación al cargar la ventana
window.onload = initializeApp;
