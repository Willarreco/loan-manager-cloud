import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { createClient } from '@supabase/supabase-js';
import { existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SESSION_DIR = join(__dirname, '.wwebjs_auth');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error('Erro: SUPABASE_URL e SUPABASE_SERVICE_KEY obrigatorios.');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

let qrExibido = false;

const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'bot', dataPath: SESSION_DIR }),
    puppeteer: {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu']
    }
});

client.on('qr', (qr) => {
    if (!qrExibido) {
        qrExibido = true;
        console.log('');
        console.log('============================================');
        console.log('  ESCANEIE O QR CODE COM O WHATSAPP');
        console.log('  Menu > Dispositivos Conectados');
        console.log('============================================');
        console.log('');
        qrcode.generate(qr, { small: true });
        console.log('');
        console.log('Link para QR: https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=' + encodeURIComponent(qr));
        console.log('============================================');
        console.log('');
    }
});

client.on('authenticated', () => {
    console.log('WhatsApp autenticado!');
});

client.on('ready', async () => {
    console.log('WhatsApp conectado!');
    await processarPagamentos();
    await client.destroy();
    process.exit(0);
});

client.on('auth_failure', (msg) => {
    console.error('Falha de autenticacao:', msg);
    process.exit(1);
});

client.on('disconnected', (reason) => {
    console.log('WhatsApp desconectado:', reason);
    if (!qrExibido && reason !== 'NAVIGATION') {
        process.exit(1);
    }
});

console.log('Iniciando WhatsApp...');
client.initialize();

// Timeout de 10 minutos
setTimeout(() => {
    if (!qrExibido) {
        console.error('QR code nao foi gerado. Verifique a conexao.');
    } else {
        console.error('Tempo esgotado. QR nao escaneado.');
    }
    process.exit(1);
}, 600000);

async function processarPagamentos() {
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
        console.log('Nenhum pagamento vencendo hoje com notificacao automatica.');
        return;
    }

    console.log('Enviando para ' + loans.length + ' cliente(s)...');
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
            const chatId = telefone + '@c.us';
            await client.sendMessage(chatId, message);
            console.log('Enviado para ' + loan.nome + ' (' + telefone + ')');
        } catch (err) {
            console.error('Erro ao enviar para ' + loan.nome + ': ' + err.message);
        }
    }

    console.log('');
    console.log('Processamento concluido!');
}
