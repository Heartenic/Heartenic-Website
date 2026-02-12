import { ESPLoader, Transport } from './esptool.bundle.js';

// DOM Elements
const btnConnect = document.getElementById('btn-connect');
const statusBadge = document.getElementById('connection-status');
const groupRhythm = document.getElementById('group-rhythm');
const groupPersonality = document.getElementById('group-personality');
const groupFlash = document.getElementById('group-flash');
const btnFlash = document.getElementById('btn-flash');
const progressFill = document.getElementById('progress-fill');
const statusText = document.getElementById('status-text');
const logContainer = document.getElementById('log-container');
const toggleLogBtn = document.getElementById('toggle-log');

const rhythmBtns = document.querySelectorAll('.rhythm-btn');
const personalityBtns = document.querySelectorAll('.personality-btn');

// State
let device = null;
let transport = null;
let esploader = null;
let connected = false;
let selectedRhythm = 'corto';       // Default
let selectedPersonality = 'minimalista'; // Default

// --- Logging Helper ---
function log(msg, type = 'info') {
    const ts = new Date().toLocaleTimeString();
    const color = type === 'error' ? '#ff5555' : (type === 'success' ? '#55ff55' : '#aaaaaa');
    logContainer.innerHTML += `<div style="color:${color}">[${ts}] ${msg}</div>`;
    logContainer.scrollTop = logContainer.scrollHeight;
    console.log(`[${type}] ${msg}`);
}

// --- Toggle Log Visibility ---
toggleLogBtn.addEventListener('click', () => {
    if (logContainer.style.display === 'none') {
        logContainer.style.display = 'block';
        toggleLogBtn.textContent = 'Ocultar detalles ▲';
    } else {
        logContainer.style.display = 'none';
        toggleLogBtn.textContent = 'Ver detalles técnicos ▼';
    }
});

// --- Rhythm Selection ---
rhythmBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        rhythmBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedRhythm = btn.dataset.rhythm;
        log(`Ritmo seleccionado: ${selectedRhythm.toUpperCase()}`);
    });
});

// --- Personality Selection ---
personalityBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        personalityBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedPersonality = btn.dataset.personality;
        log(`Personalidad seleccionada: ${selectedPersonality.toUpperCase()}`);
    });
});

// --- Connection Logic ---
btnConnect.addEventListener('click', async () => {
    if (connected) return; // Already connected

    if (!navigator.serial) {
        alert('Tu navegador no soporta Web Serial API. Por favor usa Chrome, Edge o Opera.');
        return;
    }

    try {
        device = await navigator.serial.requestPort();

        // Open port manually with standard baudrate
        await device.open({ baudRate: 115200 });

        // CRITICAL: Set signals to prevent reset/bootloader mode
        // DTR: false, RTS: false keeps the chip running normally
        await device.setSignals({ dataTerminalReady: false, requestToSend: false });

        transport = new Transport(device, true); // Initialize Transport only

        log('Puerto abierto. Dispositivo listo (Lazy Connection).', 'info');
        console.log('Device opened. Signals set to keep alive.');

        // Update UI State as "Connected" but device is still running its app
        connected = true;
        statusBadge.textContent = 'Conectado';
        statusBadge.className = 'status-badge status-connected';
        statusBadge.innerHTML = '<i class="fas fa-check-circle"></i> Conectado';

        // Enable other groups
        groupRhythm.style.opacity = '1';
        groupRhythm.style.pointerEvents = 'auto';

        groupPersonality.style.opacity = '1';
        groupPersonality.style.pointerEvents = 'auto';

        groupFlash.style.opacity = '1';
        groupFlash.style.pointerEvents = 'auto';

        // Switch button to "Desconectar" logic or just hide/change
        btnConnect.style.display = 'none';

        log('¡Conexión exitosa! Puedes configurar tu Meditador sin interrumpirlo.', 'success');

    } catch (e) {
        console.error(e);
        log(`Error de conexión: ${e.message}`, 'error');
        alert('No se pudo conectar al dispositivo. ' + e.message);
        connected = false;
    }
});

// --- Flashing Logic ---
btnFlash.addEventListener('click', async () => {
    if (!connected) return;

    // Disable button to prevent double click
    btnFlash.disabled = true;
    statusText.textContent = "Preparando...";
    progressFill.style.width = '0%';

    // Variable to track if we need to close port at the end
    let needsTeardown = true;

    try {
        // Construct filename
        const firmwareFile = `firmwares/breathing_${selectedRhythm}_pet_${selectedPersonality}.bin`;

        log(`--- Iniciando Flasheo ---`);
        log(`Configuración: ${selectedRhythm.toUpperCase()} / ${selectedPersonality.toUpperCase()}`);

        // 1. Just-in-Time Loader Instantiation
        statusText.textContent = "Entrando en modo Bootloader...";
        log('Despertando Bootloader...');

        // === CORRECCIÓN CRÍTICA AQUÍ ===
        // Paso 0: Limpiar el Transport anterior. 
        // El Transport mantiene un 'Reader' bloqueando el puerto. Debemos matarlo antes de cerrar el dispositivo.
        if (transport) {
            try {
                // disconnect() libera los locks de lectura/escritura
                await transport.disconnect();
            } catch (e) {
                console.warn("Transport disconnect warning:", e);
            }
            transport = null; // Limpiamos la referencia vieja
        }

        // Paso 1: Cerrar el dispositivo físico
        // Ahora que el reader está libre, device.close() debería funcionar sin errores.
        if (device && device.opened) {
            log('Liberando puerto para modo bootloader...', 'info');
            await device.close();
            // Pequeña pausa para que el sistema operativo registre el cierre
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        // ===============================

        // Re-initialize loader here just in time
        // Creamos un nuevo transport limpio
        transport = new Transport(device, true);

        esploader = new ESPLoader({
            transport,
            baudrate: 115200,
            romBaudrate: 115200,
            terminal: {
                clean: () => { },
                write: (data) => log(data.trim(), 'info'),
                writeLine: (data) => log(data.trim(), 'info')
            }
        });

        // Now we interrupt the device!
        // esploader.main() intentará abrir el puerto de nuevo. Como lo cerramos arriba, tendrá éxito.
        await esploader.main();
        log('Bootloader activo. Chip detenido.', 'success');

        // 2. Download Firmware
        statusText.textContent = "Descargando firmware...";
        const response = await fetch(firmwareFile);
        if (!response.ok) throw new Error(`No se encontró el archivo ${firmwareFile}`);

        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();
        const fileData = new Uint8Array(arrayBuffer);

        // Convert to Binary String for esptool-js
        let binaryString = "";
        for (let i = 0; i < fileData.length; i++) {
            binaryString += String.fromCharCode(fileData[i]);
        }

        log(`Firmware descargado (${fileData.length} bytes).`, 'success');

        // 3. Prepare & Flash
        const fileArray = [{ data: binaryString, address: 0x0000 }];

        statusText.textContent = "Borrando e Iniciando escritura...";
        statusBadge.className = 'status-badge status-busy';
        statusBadge.textContent = 'Flasheando...';

        await esploader.writeFlash({
            fileArray: fileArray,
            flashSize: 'keep',
            flashMode: 'dio',
            flashFreq: '40m',
            eraseAll: false,
            compress: true,
            reportProgress: (fileIndex, written, total) => {
                let percent = Math.round((written / total) * 100);
                if (percent > 99) percent = 99; // UX Fix: Cap at 99% to avoid premature disconnect
                progressFill.style.width = `${percent}%`;
                statusText.textContent = `Escribiendo: ${percent}%`;
            }
        });

        statusText.textContent = "¡Flasheo Completado!";
        log('Escritura exitosa.', 'success');

        // 4. Reset Device
        log('Reiniciando dispositivo...');
        
        // Envolvemos el reinicio en su propio try/catch silencioso
        // Porque a veces el "Leaving..." de esptool ya reseteó el chip y el puerto no responde.
        try {
            await transport.setDTR(false);
            await transport.setRTS(true);
            await new Promise(r => setTimeout(r, 100));
            await transport.setRTS(false);
            log('Señal de reinicio enviada.', 'info');
        } catch (resetErr) {
            // Si falla aquí, es muy probable que el chip ya se haya reiniciado solo
            // o que el puerto se haya cerrado prematuramente. No es un error fatal.
            console.warn("Advertencia menor al reiniciar:", resetErr);
            log('Nota: El dispositivo se reinició automáticamente o el puerto se liberó antes.', 'warning');
        }

        alert('¡Tu Meditador ha sido actualizado con éxito! El dispositivo se reiniciará ahora.');

    } catch (e) {
        console.error(e);
        log(`Error CRÍTICO: ${e.message}`, 'error');
        statusText.textContent = "Error al flashear";
        statusBadge.className = 'status-badge status-disconnected';
        statusBadge.textContent = 'Error';
        alert(`Ocurrió un error: ${e.message}`);
    } finally {
        // 5. TEARDOWN (Explicit Disconnect)
        if (needsTeardown) {
            log('Cerrando conexión y liberando puerto...', 'info');
            try {
                // Intento de limpieza final
                if (transport) {
                    await transport.disconnect();
                }
                if (device && device.opened) {
                    await device.close();
                }
            } catch (closeErr) {
                console.warn("Error closing port:", closeErr);
                log('Nota: El puerto podría requerir desconexión física si quedó bloqueado.', 'warning');
            }

            // Reset JS State
            device = null;
            transport = null;
            esploader = null;
            connected = false;

            // Reset UI State
            statusBadge.className = 'status-badge status-disconnected';
            statusBadge.textContent = 'Desconectado';
            statusBadge.innerHTML = 'Desconectado';

            // Disable groups
            groupRhythm.style.opacity = '0.5';
            groupRhythm.style.pointerEvents = 'none';
            groupPersonality.style.opacity = '0.5';
            groupPersonality.style.pointerEvents = 'none';
            groupFlash.style.opacity = '0.5';
            groupFlash.style.pointerEvents = 'none';

            // Show Connect Button again
            btnConnect.style.display = 'inline-block';
            btnFlash.disabled = false;

            statusText.textContent = "Esperando...";
            progressFill.style.width = '0%';

            log('Sesión finalizada. Puerto cerrado.', 'info');
        }
    }
});