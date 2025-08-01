
document.addEventListener('DOMContentLoaded', () => {
    // DOM Element References
    const startCameraBtn = document.getElementById('start-camera-btn');
    const scanBtn = document.getElementById('scan-btn');
    const videoFeed = document.getElementById('video-feed');
    const statusText = document.getElementById('status-text');
    const collectionList = document.getElementById('collection-list');

    // State variables
    let cameraStream = null;
    let isScanning = false;
    let worker = null;
    const scannedCards = new Set(); // Use a Set to prevent duplicate card names

    /**
     * Initializes the Tesseract worker for OCR.
     * This is done once to save loading time on subsequent scans.
     */
    const initializeWorker = async () => {
        statusText.textContent = 'Status: Loading OCR Engine...';
        worker = await Tesseract.createWorker('eng', 1, {
            logger: m => {
                if (m.status === 'recognizing text') {
                    statusText.textContent = `Status: Recognizing... ${Math.round(m.progress * 100)}%`;
                }
            },
        });
        statusText.textContent = 'Status: OCR Engine Ready.';
    };
    
    // Call the initialization function as soon as the script loads
    initializeWorker();

    /**
     * Starts the camera and displays the feed in the video element.
     */
    const startCamera = async () => {
        try {
            if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                statusText.textContent = 'Status: Accessing camera...';
                cameraStream = await navigator.mediaDevices.getUserMedia({
                    video: {
                        facingMode: 'environment', // Prefer the rear camera
                        width: { ideal: 1920 },
                        height: { ideal: 1080 }
                    }
                });
                videoFeed.srcObject = cameraStream;
                videoFeed.onloadedmetadata = () => {
                    videoFeed.play();
                    startCameraBtn.textContent = 'Stop Camera';
                    scanBtn.disabled = false;
                    statusText.textContent = 'Status: Camera Active. Ready to Scan.';
                };
            } else {
                throw new Error('getUserMedia is not supported by this browser.');
            }
        } catch (error) {
            console.error("Error accessing camera:", error);
            statusText.textContent = `Error: Could not access camera. ${error.message}`;
            // A non-blocking UI element for the error is better than alert()
            const errorDiv = document.createElement('div');
            errorDiv.textContent = "Could not access the camera. Please ensure you have a camera connected and have granted permission in your browser settings.";
            errorDiv.style.color = '#fb4934';
            errorDiv.style.padding = '10px';
            errorDiv.style.textAlign = 'center';
            statusText.parentElement.prepend(errorDiv);
        }
    };

    /**
     * Stops the camera feed and releases the device.
     */
    const stopCamera = () => {
        if (cameraStream) {
            cameraStream.getTracks().forEach(track => track.stop());
            videoFeed.srcObject = null;
            cameraStream = null;
            startCameraBtn.textContent = 'Start Camera';
            scanBtn.disabled = true;
            statusText.textContent = 'Status: Idle';
        }
    };

    /**
     * Toggles the camera on and off.
     */
    startCameraBtn.addEventListener('click', () => {
        if (cameraStream) {
            stopCamera();
        } else {
            startCamera();
        }
    });

    /**
     * Captures a frame from the video, performs OCR, and fetches card data.
     */
    const scanCard = async () => {
        if (!cameraStream || isScanning) return;

        isScanning = true;
        scanBtn.disabled = true;
        statusText.textContent = 'Status: Capturing frame...';

        try {
            // Create a canvas to draw the video frame onto
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            
            // Define the capture area based on the overlay
            const videoWidth = videoFeed.videoWidth;
            const videoHeight = videoFeed.videoHeight;
            canvas.width = videoWidth;
            canvas.height = videoHeight;

            // Draw the current video frame to the canvas (mirrored back)
            context.translate(videoWidth, 0);
            context.scale(-1, 1);
            context.drawImage(videoFeed, 0, 0, videoWidth, videoHeight);
            
            // Define the rectangle for OCR based on the overlay's position and size
            const ocrRect = {
                left: videoWidth * 0.10, // Corresponds to .card-outline width 80%
                top: videoHeight * 0.40, // Corresponds to .card-outline position
                width: videoWidth * 0.80,
                height: videoHeight * 0.20
            };

            // Perform OCR on the defined rectangle of the canvas
            const { data: { text } } = await worker.recognize(canvas, { rectangle: ocrRect });
            
            // Clean up the recognized text
            const cardName = text.trim().split('\n')[0].replace(/[^a-zA-Z\s,']+/g, '').trim();

            if (cardName && cardName.length > 2) {
                statusText.textContent = `Status: Found text "${cardName}". Searching Scryfall...`;
                await fetchCardData(cardName);
            } else {
                statusText.textContent = 'Status: No usable text found. Try again.';
            }

        } catch (error) {
            console.error("Error during scan:", error);
            statusText.textContent = 'Status: Error during scan. Please try again.';
        } finally {
            isScanning = false;
            scanBtn.disabled = false;
        }
    };

    scanBtn.addEventListener('click', scanCard);

    /**
     * Fetches card data from the Scryfall API using fuzzy search.
     * @param {string} name The card name identified by OCR.
     */
    const fetchCardData = async (name) => {
        try {
            // The Scryfall API endpoint for fuzzy name search
            const apiUrl = `https://api.scryfall.com/cards/named?fuzzy=${encodeURIComponent(name)}`;
            const response = await fetch(apiUrl);

            if (!response.ok) {
                throw new Error(`Scryfall API returned status ${response.status}`);
            }

            const cardData = await response.json();
            
            // Check if we already have this card in our collection
            if (scannedCards.has(cardData.name)) {
                statusText.textContent = `Status: Already collected "${cardData.name}".`;
                return; // Exit if card is a duplicate
            }

            statusText.textContent = `Status: Found "${cardData.name}"!`;
            addCardToCollection(cardData);
            scannedCards.add(cardData.name);

        } catch (error) {
            console.error("Error fetching from Scryfall:", error);
            statusText.textContent = `Status: Could not find a card matching "${name}".`;
        }
    };

    /**
     * Adds a card to the visual collection list in the right panel.
     * @param {object} cardData The card object from the Scryfall API.
     */
    const addCardToCollection = (cardData) => {
        const cardElement = document.createElement('div');
        cardElement.className = 'collection-item';

        // Use the small image version for the list and provide a valid placeholder
        const placeholderUrl = '[https://placehold.co/60x84/1d2021/fbf1c7?text=](https://placehold.co/60x84/1d2021/fbf1c7?text=)?';
        const imageUrl = cardData.image_uris?.small || cardData.card_faces?.[0]?.image_uris?.small || placeholderUrl;
        const cardType = cardData.type_line;
        const cardSet = cardData.set_name;

        cardElement.innerHTML = `
            <img src="${imageUrl}" alt="${cardData.name}" onerror="this.onerror=null;this.src='${placeholderUrl}';">
            <div class="collection-item-info">
                <p class="card-name">${cardData.name}</p>
                <p>${cardType}</p>
                <p><em>${cardSet}</em></p>
            </div>
        `;
        
        // Add the new card to the top of the list
        collectionList.prepend(cardElement);
    };
});
