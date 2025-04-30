/**
 * ====================================================================
 * LexoGraphix Plus Ebook Reader & Chat Widget
 * ====================================================================
 * Fetches books from a Google Apps Script endpoint, handles filtering
 * and pagination client-side, displays book samples page-by-page in
 * a multi-step modal, shows a lead capture form in the modal after
 * the sample, and provides a chat-style contact form widget accessible
 * via a floating button. Uses Webhooks for both lead capture and
 * contact form submissions. Converts Google Drive image links for display.
 */
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM fully loaded - LexoGraphix Plus Ebook Reader & Chat Widget");

    // --- Configuration ---
    // IMPORTANT: Replace placeholder URLs!
    // Add '?action=getPublishedBooks' to the end of your Apps Script URL
    const DATA_SOURCE_URL = "https://script.google.com/macros/s/AKfycbzG_29rRGIFEEf5-oFqALc2wr2tyOd22B2yF5p7HzBzVILGYzpJy0nXxslnX5RQu3NJ/exec?action=getPublishedBooks"; // <-- VERIFY & ADD ?action=getPublishedBooks
    const LEAD_CAPTURE_WEBHOOK_URL = "YOUR_LEAD_CAPTURE_MAKE_WEBHOOK_URL"; // <-- REPLACE THIS with your Make/Zapier/etc. webhook URL for leads
    const CONTACT_FORM_WEBHOOK_URL = "YOUR_CONTACT_FORM_MAKE_WEBHOOK_URL"; // <-- REPLACE THIS with your Make/Zapier/etc. webhook URL for contacts
    const CARD_PLACEHOLDER_IMG = ''; // Set to a URL if you want a placeholder image for cards with no cover

    const BOOKS_PER_PAGE = 8; // Number of books to display per page
    const TOTAL_PREVIEW_PAGES = 4; // Number of sample pages before showing the lead form

    // --- Global Variables ---
    let allBooks = []; // Stores all fetched books
    let filteredBooks = []; // Stores books after applying search/genre filters
    let currentPage = 1; // Current page number for pagination
    let currentModalBook = null; // Stores the book data currently shown in the modal
    let currentModalStep = 1; // Current step (page number or form) in the book modal

    // --- DOM Element Selectors ---
    // Navigation & General UI
    const menuToggle = document.getElementById('menuToggle');
    const navLinks = document.getElementById('navLinks');
    const body = document.body; // Used for controlling scroll when modals are open
    const currentYearSpan = document.getElementById('currentYear');
    // Book Grid & Filtering
    const bookGrid = document.getElementById('bookGrid');
    const loadingSpinner = document.getElementById('loadingSpinner');
    const errorMessageElement = document.getElementById('errorMessage');
    const searchInput = document.getElementById('searchInput');
    const genreFilter = document.getElementById('genreFilter');
    const paginationList = document.getElementById('paginationList');
    const progressIndicator = document.getElementById('progressIndicator');
    // Book Modal Elements
    const bookModalOverlay = document.getElementById('bookModalOverlay');
    const bookModalCloseBtn = document.getElementById('modalCloseBtn');
    const modalBookTitle = document.getElementById('modalBookTitle');
    const modalBody = document.getElementById('modalBody'); // Scrollable area
    const modalPageContentContainer = document.getElementById('modalPageContentContainer');
    const modalPageContent = document.getElementById('modalPageContent'); // Where book text goes
    const modalNavigation = document.getElementById('modalNavigation');
    const modalPrevBtn = document.getElementById('modalPrevBtn');
    const modalNextBtn = document.getElementById('modalNextBtn');
    const modalStepIndicator = document.getElementById('modalStepIndicator');
    const modalFormContainer = document.getElementById('modalFormContainer'); // Lead form container
    const modalLeadForm = document.getElementById('modalLeadForm');
    const modalInputName = document.getElementById('modalInputName');
    const modalInputEmail = document.getElementById('modalInputEmail');
    const modalFormFeedback = document.getElementById('modalFormFeedback'); // Feedback for lead form
    const modalSubmitFormBtn = document.getElementById('modalSubmitFormBtn');
    // Chat Widget Elements
    const floatingContactButton = document.getElementById('floatingContactButton'); // Button to open chat
    const chatWidget = document.getElementById('chatWidget'); // The chat widget container
    const chatWidgetCloseBtn = document.getElementById('chatWidgetCloseBtn'); // Button to close chat
    const chatForm = document.getElementById('chatForm'); // The contact form inside the widget
    const chatInputName = document.getElementById('chatInputName');
    const chatInputEmail = document.getElementById('chatInputEmail');
    const chatInputMessage = document.getElementById('chatInputMessage');
    const chatFormFeedback = document.getElementById('chatFormFeedback'); // Feedback for chat form
    const chatSubmitFormBtn = document.getElementById('chatSubmitFormBtn');


    // --- Helper Functions ---

    /**
     * Sanitizes a string to prevent basic XSS by converting it to text content
     * and then back to HTML, replacing newlines with <br> tags.
     * @param {string} str - The string to sanitize.
     * @returns {string} The sanitized HTML string.
     */
    const sanitizeHTML = (str) => {
        if (!str) return '';
        const temp = document.createElement('div');
        temp.textContent = str; // Treat input as plain text
        return temp.innerHTML.replace(/\n/g, '<br>'); // Convert text representation to HTML, replace newlines
    };

    /**
     * Converts a Google Drive file sharing URL to a direct image view URL.
     * Handles common Google Drive link formats.
     * @param {string} googleDriveUrl - The Google Drive sharing URL.
     * @returns {string} The direct image URL or the original URL if conversion fails.
     */
    function getDirectGoogleDriveImageUrl(googleDriveUrl) {
        if (!googleDriveUrl || typeof googleDriveUrl !== 'string' || !googleDriveUrl.includes('drive.google.com')) {
            return googleDriveUrl || ''; // Return original or empty if invalid input
        }
        // Regex to extract the file ID (typically 25+ alphanumeric chars with hyphens/underscores)
        const fileIdMatch = googleDriveUrl.match(/[-\w]{25,}/);
        if (fileIdMatch && fileIdMatch[0]) {
            const fileId = fileIdMatch[0];
            // Construct the direct view URL
            return `https://drive.google.com/uc?export=view&id=${fileId}`;
        } else {
            console.warn("Could not extract Google Drive file ID from URL:", googleDriveUrl);
            return googleDriveUrl; // Return original if ID extraction fails
        }
    }


    // --- UI Update Functions ---

    /**
     * Shows or hides the main loading indicator and message.
     * Clears the book grid and pagination when showing loading.
     * @param {boolean} show - Whether to show or hide the loading state.
     * @param {string} message - The message to display while loading.
     */
    const showLoading = (show = true, message = "Loading books...") => {
        if (!progressIndicator || !loadingSpinner || !bookGrid || !paginationList || !errorMessageElement) {
            console.warn("UI Update Warning: One or more required elements for loading state not found.");
            return;
        }
        errorMessageElement.style.display = 'none'; // Hide any previous errors
        if (show) {
            progressIndicator.textContent = message;
            progressIndicator.style.display = 'block';
            loadingSpinner.style.display = 'block';
            bookGrid.innerHTML = ''; // Clear previous books
            paginationList.innerHTML = ''; // Clear previous pagination
        } else {
            loadingSpinner.style.display = 'none'; // Hide spinner only
            // Progress indicator text is updated separately after loading
        }
    };

    /**
     * Displays an error message in the designated error area.
     * Hides loading indicators and clears the book grid/pagination.
     * @param {string} message - The error message to display.
     */
    const showError = (message) => {
        showLoading(false); // Hide loading spinner
        if (errorMessageElement) {
            errorMessageElement.textContent = `Error: ${message || 'Could not load books.'}`;
            errorMessageElement.style.display = 'block';
        } else {
            // Fallback if error element is missing
            console.error("Error message element not found. Error:", message);
            alert("Error: " + message);
        }
        // Ensure other elements are cleared/hidden
        if (progressIndicator) progressIndicator.style.display = 'none';
        if (bookGrid) bookGrid.innerHTML = '';
        if (paginationList) paginationList.innerHTML = '';
    };

    /**
     * Updates the progress indicator text (e.g., "Showing books 1-8 of 25").
     * Handles cases with no books found or no books available.
     * @param {number} countOnPage - Number of books currently displayed.
     * @param {number} totalFiltered - Total number of books matching filters.
     * @param {number} page - Current page number.
     * @param {number} perPage - Books per page setting.
     */
    const updateProgressIndicator = (countOnPage, totalFiltered, page = 1, perPage = BOOKS_PER_PAGE) => {
        if (!progressIndicator) return;
        if (totalFiltered === 0) {
            // Check if filters are active to show appropriate message
            const isFiltering = (searchInput?.value || genreFilter?.value !== 'all');
            progressIndicator.textContent = isFiltering ? 'No books found matching your criteria.' : 'No books available.';
        } else {
            const start = (page - 1) * perPage + 1;
            const end = Math.min(start + countOnPage - 1, totalFiltered);
            progressIndicator.textContent = `Showing books ${start}-${end} of ${totalFiltered}`;
        }
        progressIndicator.style.display = 'block';
    };

    /**
     * Renders the pagination controls based on the current page and total pages.
     * Includes Previous/Next buttons and numbered page links with ellipsis logic.
     * @param {number} currentPageNum - The current active page number.
     * @param {number} totalPages - The total number of pages.
     */
    const renderPagination = (currentPageNum, totalPages) => {
        if (!paginationList) return;
        paginationList.innerHTML = ''; // Clear existing pagination
        if (totalPages <= 1) return; // No pagination needed for 1 or 0 pages

        // Helper to create a single pagination button (li element)
        const createPageButton = (pageNumber, text = pageNumber, isDisabled = false, isActive = false, isEllipsis = false) => {
            const li = document.createElement('li');
            li.className = 'page-item';
            if (isEllipsis) {
                li.innerHTML = `<span class="page-link disabled" aria-hidden="true">...</span>`;
                li.classList.add('disabled');
            } else {
                const button = document.createElement('button');
                button.className = 'page-link';
                button.textContent = text;
                button.dataset.page = pageNumber; // Store page number for click handler
                button.disabled = isDisabled;
                if (isDisabled) button.classList.add('disabled');
                if (isActive) {
                    button.classList.add('active');
                    button.setAttribute('aria-current', 'page'); // Accessibility
                    li.classList.add('active');
                } else if (!isDisabled) {
                    // Add click listener only to active, non-disabled buttons
                    button.addEventListener('click', (e) => {
                        currentPage = parseInt(e.target.dataset.page, 10);
                        applyFiltersAndPagination(); // Re-filter and render the new page
                    });
                }
                // Add aria-labels for accessibility
                if (text === 'Previous') button.setAttribute('aria-label', 'Go to previous page');
                else if (text === 'Next') button.setAttribute('aria-label', 'Go to next page');
                else if (!isNaN(parseInt(text, 10))) button.setAttribute('aria-label', `Go to page ${text}`);

                li.appendChild(button);
            }
            return li;
        };

        // Add "Previous" button
        paginationList.appendChild(createPageButton(currentPageNum - 1, 'Previous', currentPageNum === 1));

        // Logic for numbered pages with ellipsis
        const maxPagesToShow = 5; // Max numbered buttons to show directly
        const pages = [];
        if (totalPages <= maxPagesToShow + 2) { // Show all pages if total is small
            for (let i = 1; i <= totalPages; i++) pages.push(i);
        } else { // Implement ellipsis logic
            pages.push(1); // Always show first page
            let start = Math.max(2, currentPageNum - 1);
            let end = Math.min(totalPages - 1, currentPageNum + 1);

            // Adjust start/end for edge cases (near beginning or end)
            if (currentPageNum < 4) end = 3;
            if (currentPageNum > totalPages - 3) start = totalPages - 2;

            if (start > 2) pages.push('...'); // Ellipsis before middle pages
            for (let i = start; i <= end; i++) pages.push(i);
            if (end < totalPages - 1) pages.push('...'); // Ellipsis after middle pages
            pages.push(totalPages); // Always show last page
        }

        // Create buttons for the calculated page numbers/ellipsis
        pages.forEach(page => {
            if (page === '...') {
                paginationList.appendChild(createPageButton(0, '...', true, false, true)); // Ellipsis item
            } else {
                paginationList.appendChild(createPageButton(page, page, false, page === currentPageNum)); // Numbered page
            }
        });

        // Add "Next" button
        paginationList.appendChild(createPageButton(currentPageNum + 1, 'Next', currentPageNum === totalPages));
    };


    // --- Render Books ---

    /**
     * Renders the book cards into the book grid container.
     * Handles image loading (including GDrive conversion) and errors.
     * Adds click listeners to "Start Reading" buttons.
     * @param {Array} booksToDisplay - Array of book objects to render for the current page.
     */
    const renderBooks = (booksToDisplay = []) => {
        if (!bookGrid) {
            console.error("Book grid element not found.");
            return;
        }
        bookGrid.innerHTML = ''; // Clear previous grid content

        // Message for no books is handled by updateProgressIndicator

        if (booksToDisplay.length === 0) {
            return; // Exit if no books to display
        }

        booksToDisplay.forEach(book => {
            // Ensure each book has a unique ID (fallback if missing from data)
             const bookId = book.id || `book-${Math.random().toString(36).substr(2, 9)}`;
             // Sanitize and provide defaults for book properties
             const title = book.title || 'Untitled Book';
             const author = sanitizeHTML(book.author) || 'Unknown Author';
             const originalCoverImageUrl = book.coverImageUrl;
             const description = sanitizeHTML(book.shortDescription) || 'No description available.';
             const genre = sanitizeHTML(book.genre) || 'N/A';
             // Check if any sample content exists to enable the button
             const sampleAvailable = book.page1Content || book.page2Content || book.page3Content || book.page4Content;

             // Create the card element
             const card = document.createElement('div');
             card.className = 'book-card';
             card.dataset.bookId = bookId; // Store ID for click events

             // Handle image display (convert GDrive link, provide fallback)
             const displayCoverUrl = getDirectGoogleDriveImageUrl(originalCoverImageUrl);
             let imageHTML = '';
             if (displayCoverUrl) {
                 // Use onerror to handle image load failures gracefully
                 imageHTML = `<img src="${displayCoverUrl}" alt="Cover for ${title}" loading="lazy" onerror="this.style.display='none'; this.parentElement.innerHTML += '<div class=\\'no-image-available\\'><span>Image Load Failed</span></div>'; console.error('Failed to load image:', this.src);">`;
             } else if (CARD_PLACEHOLDER_IMG) {
                 // Use placeholder if configured and no image URL
                 imageHTML = `<img src="${CARD_PLACEHOLDER_IMG}" alt="Placeholder cover for ${title}" loading="lazy">`;
             } else {
                 // Display text if no image and no placeholder
                 imageHTML = `<div class="no-image-available"><span>No Image Available</span></div>`;
             }

             // Construct the inner HTML of the card
             card.innerHTML = `
                ${imageHTML}
                 <div class="book-card-content">
                    <h3>${sanitizeHTML(title)}</h3>
                    <p class="author">By ${author}</p>
                    <p class="genre">${genre}</p>
                    <p class="description">${description}</p>
                    ${sampleAvailable ?
                        // Enable button if sample content exists
                        `<button class="btn btn-primary read-more-button" data-book-id="${bookId}" aria-label="Read sample of ${title}">Start Reading</button>` :
                        // Disable button if no sample content
                        `<button class="btn btn-primary" disabled>Sample Unavailable</button>`
                    }
                </div>`;

             // Add event listener to the "Start Reading" button if it exists
             if (sampleAvailable) {
                 const button = card.querySelector('.read-more-button');
                 if (button) {
                     button.addEventListener('click', () => {
                        // Find the full book data from the master list using the ID
                        const clickedBook = allBooks.find(b => b.id === bookId);
                         if (clickedBook) {
                            openModalWithBook(clickedBook); // Open the modal with the book data
                         } else {
                             // Handle case where book data is somehow missing (shouldn't happen normally)
                             console.error("Could not find book data for ID:", bookId);
                             Swal.fire("Error", "Could not load book details. Data mismatch.", "error");
                         }
                     });
                 }
             }
             // Add the completed card to the grid
             bookGrid.appendChild(card);
        });
    };

    // --- Populate Filters (Genre) ---

    /**
     * Populates the genre filter dropdown with unique genres from the fetched books.
     * Sorts genres alphabetically.
     */
     const populateFilters = () => {
         if (!genreFilter) return; // Exit if filter element doesn't exist
         const genres = new Set(); // Use a Set to automatically handle uniqueness
         allBooks.forEach(book => {
             if (book.genre && book.genre.trim()) {
                 // Split genres by comma or semicolon, trim whitespace, and add non-empty genres
                 book.genre.split(/[,;]/).forEach(g => {
                     const trimmedGenre = g.trim();
                     if (trimmedGenre) genres.add(trimmedGenre);
                 });
             }
         });

         // Clear existing options (except the "All Genres" default)
         while (genreFilter.options.length > 1) {
             genreFilter.remove(1);
         }

         // Sort genres alphabetically and add them as options
         [...genres].sort((a, b) => a.localeCompare(b)).forEach(g => {
             const option = document.createElement('option');
             option.value = g;
             option.textContent = g;
             genreFilter.appendChild(option);
         });
     };

    // --- Apply Filters and Pagination ---

    /**
     * Filters the `allBooks` array based on search term and selected genre.
     * Calculates pagination parameters and renders the appropriate books and controls.
     */
     const applyFiltersAndPagination = () => {
         const searchTerm = searchInput ? searchInput.value.toLowerCase().trim() : '';
         const selectedGenre = genreFilter ? genreFilter.value : 'all';

         // Filter the books
         filteredBooks = allBooks.filter(book => {
             // Check genre match (handles multiple genres per book)
             const genreMatch = selectedGenre === 'all' ||
                                (book.genre && book.genre.split(/[,;]/).some(g => g.trim() === selectedGenre));
             // Check search term match (in title or author)
             const searchMatch = !searchTerm ||
                                 (book.title && book.title.toLowerCase().includes(searchTerm)) ||
                                 (book.author && book.author.toLowerCase().includes(searchTerm));
             return genreMatch && searchMatch;
         });

         // Calculate pagination
         const totalFilteredBooks = filteredBooks.length;
         const totalPages = Math.ceil(totalFilteredBooks / BOOKS_PER_PAGE);
         // Ensure currentPage is valid (adjust if filters reduce total pages)
         currentPage = Math.max(1, Math.min(currentPage, totalPages || 1));

         // Get the slice of books for the current page
         const startIndex = (currentPage - 1) * BOOKS_PER_PAGE;
         const endIndex = startIndex + BOOKS_PER_PAGE;
         const booksToDisplay = filteredBooks.slice(startIndex, endIndex);

         // Render the results
         renderBooks(booksToDisplay);
         renderPagination(currentPage, totalPages);
         updateProgressIndicator(booksToDisplay.length, totalFilteredBooks, currentPage);
     };

    // --- Fetch Books ---

    /**
     * Fetches the book data from the configured Google Apps Script URL.
     * Handles potential errors during fetch and data parsing.
     * Initializes filters and renders the first page of books on success.
     */
     const fetchBooks = async () => {
         console.log("Fetching books...");
         showLoading(true, "Fetching books...");

         // Basic check for placeholder or missing URL
         if (DATA_SOURCE_URL.includes("YOUR_GOOGLE_APPS_SCRIPT_GET_URL") || !DATA_SOURCE_URL || !DATA_SOURCE_URL.includes("?action=getPublishedBooks")) {
             showError("Application is not configured correctly. GET URL missing, is placeholder, or missing '?action=getPublishedBooks'.");
             return;
         }

         try {
             const response = await fetch(DATA_SOURCE_URL);
             if (!response.ok) {
                 // Try to get more specific error message from response body if possible
                 let errorMsg = `HTTP error ${response.status}`;
                 try {
                     const errorData = await response.json();
                     if (errorData && (errorData.message || errorData.error)) {
                        errorMsg = errorData.message || errorData.error;
                     }
                 } catch (e) { /* Ignore if response is not JSON */ }
                 throw new Error(errorMsg);
             }

             // Check content type - expecting JSON from Apps Script
             const contentType = response.headers.get("content-type");
             if (!contentType || !contentType.includes("application/json")) {
                 const textResponse = await response.text(); // Get text for debugging
                 console.error("Non-JSON response received:", textResponse);
                 throw new Error("Invalid data format received from server. Check Apps Script deployment (make sure it returns JSON).");
             }

             const data = await response.json();

             // Check for specific error status from Apps Script (if implemented)
             if (data.status === 'error') {
                 console.error("Backend Error:", data.error || data.message);
                 throw new Error(data.message || "An error occurred on the server.");
             }

             // Ensure the data is an array as expected
             if (!Array.isArray(data)) {
                 console.error("Invalid data format received:", data);
                 throw new Error("Invalid data format received (expected an array). Check Apps Script return value.");
             }

             // Assign unique IDs if missing and store the data
             allBooks = data.map((book, index) => ({
                 ...book,
                 id: book.id || `book-${index}-${Math.random().toString(16).slice(2)}` // Fallback ID
             }));

             console.log(`Fetched ${allBooks.length} published books.`);
             populateFilters(); // Populate genre dropdown
             currentPage = 1; // Reset to first page
             applyFiltersAndPagination(); // Render initial view

         } catch (error) {
             console.error("Failed to fetch books:", error);
             showError(error.message || "Could not connect to the server.");
         } finally {
             // Ensure loading spinner is hidden regardless of success/failure
             if (loadingSpinner) loadingSpinner.style.display = 'none';
         }
     };


    // --- Book Modal Open/Close/Update Logic ---

    /** Opens the book modal overlay and focuses the close button. */
    const openBookModal = () => {
        if (!bookModalOverlay) return;
        bookModalOverlay.classList.add('active');
        document.body.style.overflow = 'hidden'; // Prevent background scroll
        // Focus close button for accessibility after short delay for transition
        if (bookModalCloseBtn) setTimeout(() => bookModalCloseBtn.focus(), 100);
    };

    /** Closes the book modal, resets state, and restores background scroll. */
    const closeBookModal = () => {
        if (!bookModalOverlay) return;
        bookModalOverlay.classList.remove('active');
        document.body.style.overflow = ''; // Restore background scroll
        // Reset modal state
        currentModalBook = null;
        currentModalStep = 1;
        if (modalPageContent) modalPageContent.innerHTML = '';
        if (modalBookTitle) modalBookTitle.textContent = '';
        // Hide form, show content area and navigation
        if (modalFormContainer) modalFormContainer.style.display = 'none';
        if (modalPageContentContainer) modalPageContentContainer.style.display = 'block';
        if (modalNavigation) modalNavigation.style.display = 'flex';
        if (modalLeadForm) modalLeadForm.reset(); // Clear form fields
        if (modalFormFeedback) modalFormFeedback.textContent = ''; // Clear feedback message
    };

    /**
     * Updates the content and navigation of the book modal based on the current step.
     * Shows book page content or the lead capture form.
     * @param {number} step - The target step (1-N for pages, N+1 for form).
     */
    const updateModalStep = (step) => {
        if (!currentModalBook || !modalPageContent || !modalStepIndicator || !modalPrevBtn || !modalNextBtn || !modalFormContainer || !modalPageContentContainer || !modalNavigation) {
            console.error("Modal update error: Missing required elements or book data.");
            return;
        }
        // Clamp step value to valid range (1 to TOTAL_PREVIEW_PAGES + 1)
        currentModalStep = Math.max(1, Math.min(step, TOTAL_PREVIEW_PAGES + 1));
        modalFormFeedback.textContent = ''; // Clear any previous form feedback

        if (currentModalStep <= TOTAL_PREVIEW_PAGES) {
            // --- Display Book Page ---
            const contentKey = `page${currentModalStep}Content`; // e.g., page1Content
            const pageHTML = sanitizeHTML(currentModalBook[contentKey]) || `<p><em>(End of page ${currentModalStep})</em></p>`; // Fallback message
            modalPageContent.innerHTML = pageHTML;

            // Update navigation elements
            modalStepIndicator.textContent = `Page ${currentModalStep} of ${TOTAL_PREVIEW_PAGES}`;
            modalPrevBtn.disabled = (currentModalStep === 1); // Disable prev on first page
            modalNextBtn.disabled = false; // Next always enabled when viewing pages
            modalNextBtn.textContent = 'Next »'; // Always show "Next" text

            // Show page content, hide form
            modalPageContentContainer.style.display = 'block';
            modalNavigation.style.display = 'flex';
            modalFormContainer.style.display = 'none';

            // Scroll page content to top
            if(modalBody) modalBody.scrollTop = 0;

        } else {
            // --- Display Lead Form ---
            modalPageContentContainer.style.display = 'none'; // Hide page content area
            modalNavigation.style.display = 'none'; // Hide page navigation
            modalFormContainer.style.display = 'block'; // Show form container
            // Focus the first form field for accessibility
            if (modalInputName) setTimeout(() => modalInputName.focus(), 100);
        }
    };

    /**
     * Initializes and opens the book modal with data for a specific book.
     * @param {object} book - The book object containing title, content, etc.
     */
    const openModalWithBook = (book) => {
        if (!book) return;
        if (!modalBookTitle || !modalPageContent) {
            console.error("Modal elements (title, page content) not found!");
            return;
        }
        currentModalBook = book; // Store the book data globally for the modal
        currentModalStep = 1; // Start at the first page
        modalBookTitle.textContent = book.title || 'Book Sample'; // Set modal title
        updateModalStep(1); // Load content for the first step
        openBookModal(); // Make the modal visible
    };

    // --- Chat Widget Open/Close Logic ---

    /** Opens the chat widget and hides the floating button. */
    const openChatWidget = () => {
        if (!chatWidget || !floatingContactButton) return;
        chatWidget.classList.add('active'); // Makes widget visible via CSS
        // Hide the floating button while chat is open
        floatingContactButton.style.opacity = '0';
        floatingContactButton.style.visibility = 'hidden';
        // Optional: Focus first input field
        if(chatInputName) setTimeout(() => chatInputName.focus(), 100);
    };

    /** Closes the chat widget and shows the floating button. */
    const closeChatWidget = () => {
        if (!chatWidget || !floatingContactButton) return;
        chatWidget.classList.remove('active'); // Hides widget via CSS
        // Show the floating button again
        floatingContactButton.style.opacity = '1';
        floatingContactButton.style.visibility = 'visible';
    };

    // --- Send Data to Webhook Function (Generic) ---

    /**
     * Sends data asynchronously to a specified webhook URL via POST request.
     * Handles loading states, feedback messages, and errors.
     * @param {string} webhookUrl - The URL of the webhook endpoint.
     * @param {object} data - The data object to send (will be JSON.stringify'd).
     * @param {HTMLElement} feedbackElement - The DOM element to display feedback messages.
     * @param {HTMLButtonElement} submitButton - The submit button to disable/enable.
     * @returns {Promise<object>} A promise resolving with {status: 'success'|'partial_success', message: string} or rejecting on error.
     */
    async function sendToWebhook(webhookUrl, data, feedbackElement, submitButton) {
        // Check if webhook URL is configured
        if (!webhookUrl || webhookUrl.startsWith("YOUR_")) {
            const errorMsg = "Webhook URL is not configured.";
            console.error(errorMsg);
            if (feedbackElement) {
                feedbackElement.textContent = errorMsg;
                feedbackElement.className = 'form-feedback error';
            } else {
                // Fallback alert if no feedback element provided
                Swal.fire('Configuration Error', errorMsg, 'error');
            }
            return Promise.reject(new Error(errorMsg)); // Reject the promise
        }

        // Log truncated URL for privacy/security
        console.log(`Sending data to webhook ${webhookUrl.substring(0, 50)}...:`, data);

        // Update UI for pending state
        if (feedbackElement) {
            feedbackElement.textContent = 'Submitting...';
            feedbackElement.className = 'form-feedback pending';
        }
        if (submitButton) submitButton.disabled = true;

        try {
            const response = await fetch(webhookUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(data),
            });

            // Check for HTTP errors
            if (!response.ok) {
                let errorDetail = `Webhook returned status ${response.status}`;
                try {
                    // Try to get more details from the response body
                    const errorText = await response.text();
                    if (errorText) errorDetail += `: ${errorText}`;
                } catch (e) { /* Ignore if response body is not text */ }
                throw new Error(errorDetail); // Throw error to be caught below
            }

            // Process successful response
            const responseText = await response.text();
            console.log("Webhook Response Text:", responseText);

            // Simple check for success keywords - adjust based on your webhook's actual response
            const successKeywords = ['success', 'accepted', 'ok'];
            const isSuccess = successKeywords.some(keyword => responseText.trim().toLowerCase().includes(keyword));

            if (isSuccess) {
                 if (feedbackElement) {
                    feedbackElement.textContent = 'Message sent successfully!';
                    feedbackElement.className = 'form-feedback success';
                }
                return { status: 'success', message: 'Data sent successfully.' };
            } else {
                // Handle cases where response is OK (2xx) but doesn't explicitly confirm success
                console.warn("Webhook response was OK, but might not indicate full success. Response:", responseText);
                 if (feedbackElement) {
                    // Provide ambiguous feedback or treat as success depending on requirements
                    feedbackElement.textContent = 'Submission received.';
                    feedbackElement.className = 'form-feedback success'; // Or pending/info
                 }
                return { status: 'partial_success', message: 'Data sent, but confirmation unclear.' };
            }
        } catch (error) {
            // Handle fetch errors or errors thrown from response check
            console.error('Failed to send data to webhook:', error);
            if (feedbackElement) {
                feedbackElement.textContent = `Submission failed: ${error.message || 'Please try again.'}`;
                feedbackElement.className = 'form-feedback error';
            }
            throw error; // Re-throw the error so the calling function knows it failed
        } finally {
             // Always re-enable the submit button
             if (submitButton) submitButton.disabled = false;
        }
    }


    // --- Event Listeners ---

    // Mobile Menu Toggle
    if (menuToggle && navLinks) {
        menuToggle.addEventListener('click', () => {
            const isExpanded = menuToggle.getAttribute('aria-expanded') === 'true';
            menuToggle.setAttribute('aria-expanded', !isExpanded);
            navLinks.classList.toggle('active');
            // Toggle hamburger/close icon
            const icon = menuToggle.querySelector('i');
            if (icon) {
                icon.classList.toggle('fa-bars', isExpanded);
                icon.classList.toggle('fa-times', !isExpanded);
            }
        });
        // Close menu when a link is clicked (optional)
        navLinks.querySelectorAll('a').forEach(link => {
            link.addEventListener('click', () => {
                if (navLinks.classList.contains('active')) {
                    menuToggle.click(); // Simulate click to close
                }
            });
        });
    }

    // Book Modal Close Listeners
    if (bookModalCloseBtn) bookModalCloseBtn.addEventListener('click', closeBookModal);
    // Close modal if clicking outside the content area
    if (bookModalOverlay) bookModalOverlay.addEventListener('click', (e) => {
        if (e.target === bookModalOverlay) { // Check if the click was directly on the overlay
             closeBookModal();
        }
    });

    // Chat Widget Open/Close Listeners
    if (floatingContactButton) floatingContactButton.addEventListener('click', openChatWidget);
    if (chatWidgetCloseBtn) chatWidgetCloseBtn.addEventListener('click', closeChatWidget);

    // Filtering/Search Event Listeners (Trigger re-filtering)
    if (searchInput) searchInput.addEventListener('input', () => {
        currentPage = 1; // Reset to page 1 when searching
        applyFiltersAndPagination();
    });
    if (genreFilter) genreFilter.addEventListener('change', () => {
        currentPage = 1; // Reset to page 1 when changing genre
        applyFiltersAndPagination();
    });

    // Global Escape Key Listener (Closes Chat or Modal)
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            // Prioritize closing the chat widget if it's active
            if (chatWidget?.classList.contains('active')) {
                closeChatWidget();
            } else if (bookModalOverlay?.classList.contains('active')) {
                // Otherwise, close the book modal if it's active
                closeBookModal();
            }
        }
    });

    // Book Modal Navigation Button Listeners
    if (modalPrevBtn) modalPrevBtn.addEventListener('click', () => {
        updateModalStep(currentModalStep - 1); // Go to previous step
    });
    if (modalNextBtn) modalNextBtn.addEventListener('click', () => {
        updateModalStep(currentModalStep + 1); // Go to next step
    });

    // Book Modal Lead Form Submission Listener
    if (modalLeadForm) {
        modalLeadForm.addEventListener('submit', async (event) => {
            event.preventDefault(); // Prevent default form submission
            // Ensure required elements and data are present
            if (!currentModalBook || !modalInputName || !modalInputEmail || !modalFormFeedback || !modalSubmitFormBtn) {
                console.error("Lead form submission error: Missing elements or book data.");
                return;
            }
            // Get and trim form values
            const name = modalInputName.value.trim();
            const email = modalInputEmail.value.trim();

            // Basic validation
            if (!name || !email) {
                modalFormFeedback.textContent = 'Please fill out both name and email.';
                modalFormFeedback.className = 'form-feedback error';
                return;
            }
            // Simple email format check
            if (!/^\S+@\S+\.\S+/.test(email)) {
                modalFormFeedback.textContent = 'Please enter a valid email address.';
                modalFormFeedback.className = 'form-feedback error';
                return;
            }

            // Prepare data for webhook
            const leadData = {
                leadName: name,
                leadEmail: email,
                bookTitle: currentModalBook.title || 'Unknown Title',
                source: 'Book Modal Lead' // Identify the source of the lead
            };

            try {
                // Send data using the generic webhook function
                await sendToWebhook(LEAD_CAPTURE_WEBHOOK_URL, leadData, modalFormFeedback, modalSubmitFormBtn);
                // On success:
                modalFormFeedback.textContent = ''; // Clear feedback before showing Swal
                closeBookModal(); // Close the modal

                // Show confirmation message (redirect if purchase link exists)
                if (currentModalBook.purchaseLink) {
                    Swal.fire({
                        title: 'Thank You!',
                        text: 'You will now be redirected to the purchase page.',
                        icon: 'success',
                        timer: 2500, // Auto close after 2.5 seconds
                        showConfirmButton: false
                    }).then(() => {
                        window.location.href = currentModalBook.purchaseLink; // Redirect
                    });
                } else {
                    Swal.fire('Thank You!', 'Your information has been submitted.', 'success');
                }
            } catch (error) {
                // Error handling is done within sendToWebhook (updates feedbackElement)
                console.error("Error submitting lead form:", error);
            }
            // Button disable/enable is handled within sendToWebhook
        });
    }

    // Chat Widget Form Submission Listener
    if (chatForm) {
        chatForm.addEventListener('submit', async (event) => {
            event.preventDefault(); // Prevent default form submission
            // Ensure form elements exist
            if (!chatInputName || !chatInputEmail || !chatInputMessage || !chatFormFeedback || !chatSubmitFormBtn) {
                console.error("Chat form submission error: Missing form elements.");
                return;
            }
            // Get and trim form values
            const name = chatInputName.value.trim();
            const email = chatInputEmail.value.trim();
            const message = chatInputMessage.value.trim();

            // Basic Validation
            let isValid = true;
            if (!name) {
                chatFormFeedback.textContent = 'Please enter your name.';
                isValid = false;
            } else if (!email || !/^\S+@\S+\.\S+/.test(email)) { // Simple email check
                chatFormFeedback.textContent = 'Please enter a valid email address.';
                isValid = false;
            } else if (!message) {
                chatFormFeedback.textContent = 'Please enter your message.';
                isValid = false;
            }

            // Display error and stop if invalid
            if (!isValid) {
                chatFormFeedback.className = 'form-feedback error';
                return;
            }

            // Prepare data for webhook
            const contactData = {
                contactName: name,
                contactEmail: email,
                contactMessage: message,
                source: 'Chat Widget Contact Form' // Identify the source
            };

            try {
                 // Send data using the generic webhook function
                 const result = await sendToWebhook(CONTACT_FORM_WEBHOOK_URL, contactData, chatFormFeedback, chatSubmitFormBtn);

                 // If the webhook call was successful:
                 if(result.status === 'success') {
                     // Wait briefly after success message shows, then clear form, close widget, show Swal
                     setTimeout(() => {
                         chatForm.reset(); // Clear the form fields
                         closeChatWidget(); // Close the chat widget
                         // Clear feedback *before* closing to avoid flash of old message
                         chatFormFeedback.textContent = '';
                         chatFormFeedback.className = 'form-feedback';
                         // Show final confirmation
                         Swal.fire('Message Sent!', 'Thank you for contacting us. We will get back to you soon.', 'success');
                     }, 1500); // Delay in milliseconds (1.5 seconds)
                 }
                 // If sendToWebhook resulted in an error, the catch block below handles it
            } catch (error) {
                // Error feedback is already set by sendToWebhook
                console.error("Error submitting contact form:", error);
            }
             // Button disable/enable is handled within sendToWebhook
        });
    }

    // --- Initial Page Load ---
    // Set current year in footer
    if (currentYearSpan) {
        currentYearSpan.textContent = new Date().getFullYear();
    }
    // Fetch books to populate the page
    fetchBooks();

}); // End DOMContentLoaded
