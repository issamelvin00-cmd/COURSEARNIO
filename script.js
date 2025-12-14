document.addEventListener('DOMContentLoaded', function () {
    const token = localStorage.getItem('token');
    if (!token) {
        window.location.href = 'login.html';
        return;
    }

    const btn = document.getElementById('simplePayBtn');

    // HARDCODED TEST KEY (Guaranteed to work if minimal_test.html worked)
    const PUBLIC_KEY = 'pk_live_a0421b8388bfc578a82a5a8ca91fd2f3ca4f03c9';

    if (btn) {
        btn.addEventListener('click', async () => {
            btn.disabled = true;
            btn.innerHTML = 'Processing...';

            try {
                // 1. Get Transaction Reference from Backend (We still need this to track the user)
                const res = await fetch('/pay/initiate', {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json'
                    }
                });

                if (!res.ok) throw new Error('Network error');
                const data = await res.json(); // { reference: 'REF_...' }

                // 2. Launch Paystack (Using Hardcoded Key + Backend Reference)
                const handler = PaystackPop.setup({
                    key: PUBLIC_KEY,
                    email: data.email || 'user@earnio.com',
                    amount: 10000, // 100 KES
                    currency: 'KES',
                    ref: data.reference, // Important: Connects payment to user
                    callback: function (response) {
                        window.location.href = `/payment-success.html?ref=${response.reference}`;
                    },
                    onClose: function () {
                        alert('Transaction Canceled');
                        btn.disabled = false;
                        btn.innerHTML = '<i class="fas fa-lock"></i> Pay KES 100 to Register';
                    }
                });

                handler.openIframe();

            } catch (err) {
                alert('Connection Error: ' + err.message);
                btn.disabled = false;
                btn.innerHTML = 'Try Again';
            }
        });
    }
});
