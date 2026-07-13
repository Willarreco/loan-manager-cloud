import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { create } from 'tar';
import pino from 'pino';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = join(__dirname, 'baileys-session');
const OUT_FILE = join(__dirname, 'session.tar.gz');

async function setup() {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ['WA Emprestimo Bot', 'Chrome', '1.0.0'],
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            console.log('\n=== ESCANEIE O QR CODE ABAIXO COM O WHATSAPP ===\n');
            qrcode.generate(qr, { small: false });
            console.log('\n================================================\n');
        }
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason === DisconnectReason.loggedOut) {
                console.log('WhatsApp deslogado. Remova a pasta baileys-session e execute novamente.');
                process.exit(1);
            }
            console.log('Conexão fechada. Reconectando...');
            setup();
        }
        if (connection === 'open') {
            console.log('\n✅ WhatsApp conectado com sucesso!\n');

            await create({ gzip: true, file: OUT_FILE, cwd: SESSION_DIR }, ['.']);

            const data = readFileSync(OUT_FILE);
            const b64 = data.toString('base64');
            console.log('\n=== ADICIONE ISSO COMO SECRET DO GITHUB ===');
            console.log('Nome: WHATSAPP_SESSION');
            console.log('Valor:');
            console.log(b64);
            console.log('==========================================\n');

            setTimeout(() => {
                sock.logout();
                process.exit(0);
            }, 2000);
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

setup();
