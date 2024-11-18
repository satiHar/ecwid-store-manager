document.addEventListener('DOMContentLoaded', function () {
    const loginInput = document.getElementById('loginInput');
    const passwordInput = document.getElementById('passwordInput');
    const commentInput = document.getElementById('commentInput');
    const registerButton = document.getElementById('registerButton');
    const resultContainer = document.getElementById('resultContainer');
    const spinner = document.getElementById('spinner');
    const countryDropdown = document.getElementById('countryDropdown');
    const currencyDropdown = document.getElementById('currencyDropdown');
    const planDropdown = document.getElementById('planDropdown');
    const createdStoresButton = document.getElementById('createdStores');
    const createdStoresList = document.getElementById('createdStoresList');

    async function getSandboxNameFromUrl() {
        try {
            const currentTabUrl = await getCurrentTabUrl();
            const domainPart = currentTabUrl.split('https://')[1];
            const myIndex = domainPart.indexOf('my');
            if (myIndex !== -1) {
                return domainPart.slice(myIndex + 2, domainPart.indexOf('.', myIndex));
            }
            return '';
        } catch (error) {
            console.log("Error extracting sandbox name:", error);
            return '';
        }
    }

    async function getCurrentTabUrl() {
        return new Promise((resolve, reject) => {
            chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
                if (tabs.length > 0) {
                    resolve(tabs[0].url);
                } else {
                    reject('No active tab found.');
                }
            });
        });
    }

    function saveDataToStorage(email, comment, sandboxName) {
        chrome.storage.local.get(['sandboxData'], function (result) {
            let sandboxData = result.sandboxData || {};

            if (!sandboxData[sandboxName]) {
                sandboxData[sandboxName] = {};
            }

            sandboxData[sandboxName][email] = comment;

            chrome.storage.local.set({ sandboxData: sandboxData }, function () {
                console.log(`Sandbox: ${sandboxName}, Email: ${email}, Comment: ${comment}`);
            });
        });
    }

    async function displayCreatedStores() {
        const sandboxName = await getSandboxNameFromUrl();
        chrome.storage.local.get(['sandboxData'], function (result) {
            const sandboxData = result.sandboxData || {};

            createdStoresList.innerHTML = '';

            if (!sandboxData[sandboxName] || Object.keys(sandboxData[sandboxName]).length === 0) {
                createdStoresList.innerHTML = '<p>No stores created yet.</p>';
                createdStoresList.style.display = 'block';
                return;
            }

            let index = 1;
            const storesArray = Object.keys(sandboxData[sandboxName]).map(email => {
                const comment = sandboxData[sandboxName][email];
                return { email, comment };
            });

            storesArray.reverse(); // последние добавленные будут отображаться сверху

            storesArray.forEach(store => {
                const { email, comment } = store;
                const listItem = document.createElement('p');
                listItem.textContent = `${index}. ${email} - Comment: ${comment}`;

                // обработчик события для копирования email
                listItem.addEventListener('click', function () {
                    navigator.clipboard.writeText(email).then(() => {
                        resultContainer.textContent = `Email ${email} copied to clipboard!`;
                    }).catch(err => {
                        resultContainer.textContent = 'Failed to copy email to clipboard!';
                        console.error('Error copying email: ', err);
                    });
                });

                createdStoresList.appendChild(listItem);
                index++;
            });

            if (createdStoresList.style.display === 'block') {
                createdStoresList.style.display = 'none';
            } else {
                createdStoresList.style.display = 'block';
            }
        });
    }

    async function handleInitialLoad() {
        const sandboxName = await getSandboxNameFromUrl();
        if (!sandboxName) {
            resultContainer.textContent = 'Failed to extract sandbox name from the active tab URL.';
        } else {
            console.log('Found sandboxName:', sandboxName);
        }

        // Вставка сохранённого email и пароля в поля ввода
        chrome.storage.local.get(['savedEmail', 'savedPassword'], function (result) {
            const savedEmail = result.savedEmail;
            const savedPassword = result.savedPassword;

            if (savedEmail) {
                loginInput.value = savedEmail;
            }

            if (savedPassword) {
                passwordInput.value = savedPassword;
            }
        });
    }

    async function registerStore(email, password) {
        const sandboxName = await getSandboxNameFromUrl();
        if (!sandboxName) {
            resultContainer.textContent = 'Failed to extract sandbox name from the active tab URL.';
            return;
        }

        const countryCode = countryDropdown.value;
        const currencyCode = currencyDropdown.value;
        if (!countryCode || !currencyCode) {
            resultContainer.textContent = 'Please select both country and currency.';
            return;
        }

        const apiUrl = `https://my${sandboxName}.ecwid.qa/resellerapi/v1/register?register=y`;
        const formData = new FormData();
        formData.append('email', email);
        formData.append('password', password);
        formData.append('name', 'Tester');
        formData.append('key', 'ecwid___key');
        formData.append('plan', 'ECWID_SKINNY_FREE');

        // Проверяем страну и валюту
        if (countryCode !== 'USA' || currencyCode !== 'USD') {
            const templateFileUrl = chrome.runtime.getURL("template.xml");
            try {
                const response = await fetch(templateFileUrl);
                if (!response.ok) throw new Error('Error loading XML template');
                let xmlContent = await response.text();

                xmlContent = xmlContent.replace('<countryCode></countryCode>', `<countryCode>${countryCode}</countryCode>`);
                xmlContent = xmlContent.replace('<currency></currency>', `<currency>${currencyCode}</currency>`);
                const blob = new Blob([xmlContent], { type: "application/xml" });
                formData.append("template", blob, "template.xml");

            } catch (error) {
                console.error('Failed to load template.xml', error);
                resultContainer.textContent = 'An error occurred while processing the template XML.';
                return;
            }
        }

        // запрос на регистрацию
        try {
            const responseApi = await fetch(apiUrl, { method: 'POST', body: formData });
            const responseText = await responseApi.text();

            // Обработка ответа
            if (responseApi.status === 404) {
                handleApiError(responseText);
            } else if (!responseApi.ok) {
                const errorMessage = extractErrorMessage(responseText);
                resultContainer.textContent = `Registration failed: ${errorMessage}`;
            } else {
                const ownerId = extractOwnerId(responseText);
                if (ownerId) {
                    resultContainer.textContent = `Store registered successfully! Owner ID: ${ownerId}`;
                    await handlePlanUpgrade(ownerId, sandboxName);
                    saveDataToStorage(email, commentInput.value, sandboxName); // Сохранение данных для конкретного sandboxName
                } else {
                    resultContainer.textContent = 'Registration failed: Owner ID not found.';
                }
            }
        } catch (error) {
            console.error('Request failed', error);
            resultContainer.textContent = 'An error occurred during store registration.';
        }
    }

    // Обработчик для ошибок
    function handleApiError(responseText) {
        const parser = new DOMParser();
        const htmlDoc = parser.parseFromString(responseText, "text/html");
        const title = htmlDoc.querySelector('h1')?.textContent || '404 Not Found';
        const nginxInfo = htmlDoc.querySelector('center')?.textContent || 'nginx';
        resultContainer.textContent = `${title} - ${nginxInfo}`;
    }

    function extractErrorMessage(responseText) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(responseText, "application/xml");
        return xmlDoc.getElementsByTagName("message")[0]?.textContent || 'Unknown error';
    }

    function extractOwnerId(responseText) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(responseText, "application/xml");
        return xmlDoc.getElementsByTagName("ownerid")[0]?.textContent;
    }

    async function handlePlanUpgrade(ownerId, sandboxName) {
        const selectedPlan = planDropdown.value;
        if (selectedPlan && selectedPlan !== 'ECWID_SKINNY_FREE') {
            await upgradePlan(ownerId, sandboxName, selectedPlan);
        }
    }

    async function upgradePlan(ownerId, sandboxName, plan) {
        const date = new Date();
        let dateExpires = `${date.getFullYear() + 1}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getDate().toString().padStart(2, '0')}%2000:00:00%20UTC`;

        const upgradeUrl = `https://${sandboxName}-billing.ecwid.qa/jmx/billing:name=BillingMBean/subscribe?ownerId=${ownerId}&expires=${dateExpires}&product=${plan}&channelId=&reason=sloth&subscriptionPeriod=annual&superuser_auth_key=letmein`;
        try {
            await fetch(upgradeUrl, { method: 'POST', mode: 'no-cors' });
            resultContainer.textContent = `Store upgraded to ${plan}`;
        } catch (error) {
            console.error('Upgrade request failed', error);
            resultContainer.textContent = `An error occurred while upgrading to ${plan}`;
        }
    }

    function isValidEmail(email) {
        const emailRegex = /^[a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
        return emailRegex.test(email);
    }

    function isValidPassword(password) {
        return password.length >= 8;
    }

    // Обработчик для регистрации
    async function handleRegister() {
        const email = loginInput.value;
        let password = passwordInput.value;
        const comment = commentInput.value;

        if (!password) password = '12345678';

        if (!email || !isValidEmail(email)) {
            resultContainer.textContent = 'Please enter a valid email address.';
            return;
        }

        if (!isValidPassword(password)) {
            resultContainer.textContent = 'Password must be at least 8 characters long.';
            return;
        }

        registerButton.disabled = true;
        spinner.style.display = 'inline-block';

        try {
            // Сохраняем email и пароль
            chrome.storage.local.set({ savedEmail: email, savedPassword: password }, function () {
                console.log('Saved email and password:', email, password);
            });

            await registerStore(email, password);
        } catch (error) {
            resultContainer.textContent = 'An error occurred during store registration.';
        } finally {
            registerButton.disabled = false;
            spinner.style.display = 'none';
        }
    }

    // Обработчики событий
    registerButton.addEventListener('click', handleRegister);
    createdStoresButton.addEventListener('click', displayCreatedStores);

    document.addEventListener('keydown', function (event) {
        if (event.key === 'Enter') {
            handleRegister();
        }
    });

    handleInitialLoad();
});
