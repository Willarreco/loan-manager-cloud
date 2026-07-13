import { makeWASocket, useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { createClient } from '@supabase/supabase-js';
import { existsSync, mkdirSync, rmSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import pino from 'pino';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = join(__dirname, 'baileys-session');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Erro: SUPABASE_URL e SUPABASE_SERVICE_KEY são obrigatórios.');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

function sessaoValida() {
    const credsPath = join(SESSION_DIR, 'creds.json');
    if (!existsSync(credsPath)) return false;
    try {
        const creds = JSON.parse(readFileSync(credsPath, 'utf-8'));
        return creds.registered === true && creds.serverToken;
    } catch {
        return false;
    }
}

async function main() {
    if (existsSync(SESSION_DIR)) {
        if (sessaoValida()) {
            console.log('📂 Sessão WhatsApp válida encontrada em cache.');
        } else {
            console.log('♻️ Sessão inválida. Removendo...');
            rmSync(SESSION_DIR, { recursive: true, force: true });
        }
    }
    if (!existsSync(SESSION_DIR)) {
        mkdirSync(SESSION_DIR, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    let qrExibido = false;
    let resolvido = false;

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false,
        browser: ['WA Emprestimo Bot', 'Chrome', '1.0.0'],
        logger: pino({ level: 'silent' }),
        connectTimeoutMs: 60000,
        defaultQueryTimeoutMs: 60000,
        keepAliveIntervalMs: 30000
    });

    sock.ev.on('connection.update', (update) => {
        if (resolvido) return;
        const { connection, lastDisconnect, qr } = update;

        if (qr && !qrExibido) {
            qrExibido = true;
            console.log('');
            console.log('============================================');
            console.log('  ESCANEIE O QR CODE COM O WHATSAPP');
            console.log('  Menu > Dispositivos Conectados');
            console.log('============================================');
            console.log('');
            console.log(qr);
            console.log('');
            console.log('============================================');
            console.log('Aguardando scan...');
        }

        if (connection === 'open') {
            resolvido = true;
            if (qrExibido) {
                console.log('QR Code escaneado! WhatsApp conectado.');
            } else {
                console.log('WhatsApp conectado via sessão salva!');
            }
            
            processarPagamentos(sock).then(() => {
                sock.logout().then(() => process.exit(0));
            }).catch(err => {
                console.error('Erro:', err.message);
                sock.logout().then(() => process.exit(1));
            });
        }

        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason === DisconnectReason.loggedOut) {
                console.error('WhatsApp deslogado. Execute novamente para gerar QR.');
                resolvido = true;
                process.exit(1);
            }
        }
    });

    sock.ev.on('creds.update', saveCreds);

    // Timeout de 10 min para o GitHub Actions (timeout-max 15 min)
    await new Promise((_, reject) => {
        setTimeout(() => {
            if (!resolvido) {
                if (qrExibido) {
                    reject(new Error('Tempo esgotado. QR nao escaneado. Execute novamente.'));
                } else {
                    reject(new Error('Tempo esgotado. QR nunca foi gerado.'));
                }
            }
        }, 600000);
    }).catch(err => {
        console.error(err.message);
        process.exit(1);
    });
}

async function processarPagamentos(sock) {
    const today = new Date().toISOString().split('T')[0];
    console.log('');
    console.log('Verificando pagamentos com vencimento em ' + today + '...');
    console.log('');

    const { data: loans, error } = await supabase
        .from('loans')
        .select('id, nome, telefone, total_a_pagar, frequencia, auto_notify, pagamentos!inner(id, data_vencimento, valor, pago, whatsapp_enviado, tipo)')
        .eq('auto_notify', true)
        .eq('pagamentos.data_vencimento', today)
        .eq('pagamentos.pago', false)
        .eq('pagamentos.whatsapp_enviado', false);

    if (error) {
        throw new Error('Erro Supabase: ' + error.message);
    }

    if (!loans || loans.length === 0) {
        console.log('Nenhum pagamento vencendo hoje com notificacao automatica ativada.');
        return;
    }

    console.log('Enviando mensagens para ' + loans.length + ' cliente(s)...');
    console.log('');

    for (const loan of loans) {
        const telefone = loan.telefone.replace(/\D/g, '');
        const nome = loan.nome.split(' ')[0];
        const duePayments = loan.pagamentos.filter(p =>
            p.data_vencimento === today && !p.pago && !p.whatsapp_enviado
        );

        if (duePayments.length === 0) continue;

        const pagamentoIds = duePayments.map(p => p.id);
        await supabase.from('pagamentos').update({ whatsapp_enviado: true }).in('id', pagamentoIds);

        const message = 'Bom dia! Tudo bem?\n\n' + nome + ', passando para lembrar que hoje vence o seu compromisso de pagamento.\n\nVoce pode realizar o pagamento do valor total da divida ou, se preferir e conforme nosso combinado, efetuar apenas o pagamento dos juros.\n\nCaso tenhamos um acordo diferente, desconsidere esta mensagem e siga as condicoes previamente acertadas.\n\nQualquer duvida, estou a disposicao. Obrigado!';

        try {
            const chatId = telefone + '@s.whatsapp.net';
            await sock.sendMessage(chatId, { text: message });
            console.log('Mensagem enviada para ' + loan.nome + ' (' + telefone + ')');
        } catch (err) {
            console.error('Erro ao enviar para ' + loan.nome + ': ' + err.message);
        }
    }

    console.log('');
    console.log('Processamento concluido!');
}

main();
