/**
 * Webhook 전송 유틸리티
 */
export async function sendWebhook(url: string, payload: any, authToken?: string, secret?: string) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 seconds timeout

    try {
        const trimmedUrl = url.trim();
        console.log(`[Webhook] Attempting to send to ${trimmedUrl}...`);

        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
        };

        if (authToken) {
            headers['Authorization'] = `Bearer ${authToken}`;
            console.log(`[Webhook] Authorization header added (token prefix: ${authToken.substring(0, 10)}...)`);
        } else {
            console.log(`[Webhook] No Authorization header added`);
        }

        // Add custom security secret header if provided
        if (secret) {
            headers['x-daom-secret'] = secret;
            console.log('[Webhook] Custom security secret header added');
        }

        const response = await fetch(trimmedUrl, {
            method: 'POST',
            headers,
            body: JSON.stringify(payload),
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[Webhook] Failed with status ${response.status}: ${errorText}`);
            return { success: false, status: response.status, error: errorText };
        }

        console.log(`[Webhook] Success! Status: ${response.status}`);
        return { success: true, status: response.status };
    } catch (error: any) {
        clearTimeout(timeoutId);

        if (error.name === 'AbortError') {
            console.error(`[Webhook] Request timed out (30s)`);
            return { success: false, error: 'Request timed out' };
        }

        console.error(`[Webhook] Request failed: ${error.message}`);
        if (error.cause) {
            console.error(`[Webhook] Cause:`, error.cause);
        }
        return { success: false, error: error.message, cause: error.cause };
    }
}
