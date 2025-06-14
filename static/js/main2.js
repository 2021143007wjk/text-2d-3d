/**
 * 3D 모델 뷰어 및 채팅 프론트엔드
 * 이 스크립트는 텍스트 입력 또는 이미지 업로드를 통해 3D 모델을 생성하고
 * Three.js를 사용하여 표시하는 모든 기능을 담당합니다.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

window.addEventListener('DOMContentLoaded', () => {
    // ===== 전역 변수 및 DOM 참조 =====
    let scene, camera, renderer, controls, currentModel = null, currentModelUrl = null, currentImageUrl = null,
        ambientLight, directionalLight, axesHelper;

    // --- 기본 DOM 요소 ---
    const chatForm = document.getElementById('chatForm');
    const chatInput = document.getElementById('chatInput');
    const chatMessages = document.getElementById('chatMessages');
    const fileInput = document.getElementById('fileInput');
    const uploadBtn = document.getElementById('uploadBtn');
    const generatedImage = document.getElementById('generatedImage');
    const imagePlaceholder = document.getElementById('imagePlaceholder');
    const imageLoading = document.getElementById('imageLoading');
    const modelViewer = document.getElementById('modelViewer');
    const modelPlaceholder = document.getElementById('modelPlaceholder');
    const modelLoading = document.getElementById('modelLoading');
    const convertBtn = document.getElementById('convertBtn');
    const downloadImageBtn = document.getElementById('downloadImageBtn');
    const downloadModelBtn = document.getElementById('downloadModelBtn');
    const resetViewBtn = document.getElementById('resetViewBtn');
    const themeToggleButton = document.getElementById('themeToggleButton');
    const bodyElement = document.body;
    const mainContainer = document.querySelector('.main-container');

    // --- 설정 패널 관련 DOM 요소 ---
    const settingsButton = document.getElementById('settingsButton');

    // --- 뷰어 설정 입력 요소 ---
    const autoRotateCheck = document.getElementById('autoRotateCheck');
    const rotateSpeedSlider = document.getElementById('rotateSpeedSlider');
    const rotateSpeedValue = document.getElementById('rotateSpeedValue');
    const fovSlider = document.getElementById('fovSlider');
    const fovValue = document.getElementById('fovValue');
    const directionalLightSlider = document.getElementById('directionalLightSlider');
    const directionalLightValue = document.getElementById('directionalLightValue');
    const axesHelperCheck = document.getElementById('axesHelperCheck');

    // --- Gemma-3 및 3D 모델링 설정 요소 ---
    const temperatureSlider = document.getElementById('temperatureSlider');
    const temperatureValue = document.getElementById('temperatureValue');
    const maxTokensSlider = document.getElementById('maxTokensSlider');
    const maxTokensValue = document.getElementById('maxTokensValue');
    const inferenceStepsInput = document.getElementById('inferenceStepsInput');
    const octreeResolutionInput = document.getElementById('octreeResolutionInput');
    const seedInput = document.getElementById('seedInput');


    // ===== 테마 관리 =====
    const lightIcon = '☀️', darkIcon = '🌙';
    function setTheme(theme) {
        bodyElement.classList.toggle('dark-mode', theme === 'dark');
        if (themeToggleButton) themeToggleButton.textContent = theme === 'dark' ? lightIcon : darkIcon;
        localStorage.setItem('theme', theme);
        if (scene) {
            scene.background = new THREE.Color(theme === 'dark' ? 0x2d2d2d : 0xf8f9fa);
        }
    }
    function initializeTheme() {
        const savedTheme = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
        setTheme(savedTheme);
    }
    if (themeToggleButton) {
        themeToggleButton.addEventListener('click', () => bodyElement.classList.contains('dark-mode') ? setTheme('light') : setTheme('dark'));
    }

    // ===== 유틸리티 함수 =====
    function addMessage(role, content, duration = null) {
        const messageDiv = document.createElement('div');
        messageDiv.className = `message ${role}-message`;
        if (role === 'user') {
            messageDiv.textContent = content;
        } else {
            if (role === 'assistant' && typeof marked !== 'undefined') {
                try {
                    messageDiv.innerHTML = DOMPurify.sanitize(marked.parse(content));
                } catch (e) {
                    messageDiv.textContent = content;
                }
            } else {
                messageDiv.textContent = content;
            }
            if (duration !== null) {
                const durationSpan = document.createElement('span');
                durationSpan.className = 'response-duration';
                durationSpan.textContent = `(${duration.toFixed(2)}초)`;
                const lastP = messageDiv.querySelector('p:last-of-type');
                if(lastP) lastP.appendChild(durationSpan);
                else messageDiv.appendChild(durationSpan);
            }
        }
        chatMessages.appendChild(messageDiv);
        chatMessages.scrollTop = chatMessages.scrollHeight;
    }

    function showImageLoading(show) { imageLoading.style.display = show ? 'flex' : 'none'; }
    function showModelLoading(show) { modelLoading.style.display = show ? 'flex' : 'none'; }

    function displayImage(url) {
        currentImageUrl = url;
        generatedImage.style.display = 'none';
        imagePlaceholder.style.display = 'none';
        showImageLoading(true);
        generatedImage.onload = () => {
            showImageLoading(false);
            generatedImage.style.display = 'block';
        };
        generatedImage.onerror = () => {
            showImageLoading(false);
            imagePlaceholder.style.display = 'block';
            addMessage('assistant', '오류: 이미지를 표시할 수 없습니다.');
        };
        generatedImage.src = url;
        convertBtn.style.display = 'inline-flex';
        downloadImageBtn.style.display = 'inline-flex';
    }

    function hideModel() {
        modelViewer.style.display = 'none';
        downloadModelBtn.style.display = 'none';
        resetViewBtn.style.display = 'none';
        if (currentModel) {
            scene.remove(currentModel);
            currentModel = null;
        }
        currentModelUrl = null;
    }

    function showModel() {
        modelViewer.style.display = 'block';
        modelPlaceholder.style.display = 'none';
        downloadModelBtn.style.display = 'inline-flex';
        resetViewBtn.style.display = 'inline-flex';

        if (camera && renderer) {
            const newWidth = modelViewer.clientWidth;
            const newHeight = modelViewer.clientHeight;

            if (newWidth > 0 && newHeight > 0) {
                camera.aspect = newWidth / newHeight;
                camera.updateProjectionMatrix();
                renderer.setSize(newWidth, newHeight);
            }
        }
    }

    // ===== 3D 뷰어 초기화 및 로직 =====
    function initThreeJS() {
        scene = new THREE.Scene();
        setTheme(localStorage.getItem('theme'));

        const container = modelViewer;
        if (!container) return;

        const parentContainer = container.parentElement;
        let width = container.clientWidth > 0 ? container.clientWidth : parentContainer.clientWidth;
        let height = container.clientHeight > 0 ? container.clientHeight : parentContainer.clientHeight;

        height = Math.max(height, 200);

        camera = new THREE.PerspectiveCamera(75, width > 0 ? width / height : 1, 0.1, 1000);
        camera.position.set(0, 1, 3);

        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
        renderer.setSize(width, height);
        renderer.setPixelRatio(window.devicePixelRatio);
        container.appendChild(renderer.domElement);

        ambientLight = new THREE.AmbientLight(0xffffff, 1.5);
        scene.add(ambientLight);
        directionalLight = new THREE.DirectionalLight(0xffffff, 1.5);
        directionalLight.position.set(2, 5, 5);
        scene.add(directionalLight);

        axesHelper = new THREE.AxesHelper(5);
        scene.add(axesHelper);

        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.05;
        controls.minDistance = 1;
        controls.maxDistance = 20;
        controls.autoRotate = true;
        controls.autoRotateSpeed = 1;

        function animate() {
            requestAnimationFrame(animate);
            controls.update();
            renderer.render(scene, camera);
        }
        animate();

        window.addEventListener('resize', () => {
            if (!renderer || !camera || !modelViewer) return;
            const newWidth = modelViewer.clientWidth;
            const newHeight = modelViewer.clientHeight;

            if (newWidth > 0 && newHeight > 0) {
                camera.aspect = newWidth / newHeight;
                camera.updateProjectionMatrix();
                renderer.setSize(newWidth, newHeight);
            }
        });
    }

    function loadModel(url) {
        showModelLoading(true);
        modelPlaceholder.style.display = 'none';
        const loader = new GLTFLoader();
        loader.load(url, (gltf) => {
            if (currentModel) scene.remove(currentModel);
            currentModel = gltf.scene;

            const box = new THREE.Box3().setFromObject(currentModel);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);
            const scale = 2.0 / maxDim;

            currentModel.scale.set(scale, scale, scale);
            currentModel.position.sub(center.multiplyScalar(scale));

            scene.add(currentModel);
            showModel();
            controls.reset();
            showModelLoading(false);
        }, undefined, (error) => {
            console.error('3D 모델 로드 오류:', error);
            addMessage('assistant', '3D 모델을 불러오는 중 오류가 발생했습니다.');
            showModelLoading(false);
            modelPlaceholder.style.display = 'block';
        });
    }

    function getSettings() {
        const gemma_settings = {
            temperature: parseFloat(temperatureSlider.value),
            max_tokens: parseInt(maxTokensSlider.value, 10),
        };
        const model_3d_settings = {
            num_inference_steps: parseInt(inferenceStepsInput.value, 10),
            octree_resolution: parseInt(octreeResolutionInput.value, 10),
            seed: parseInt(seedInput.value, 10),
        };
        return { gemma_settings, model_3d_settings };
    }


    // ===== API 통신 및 이벤트 핸들러 =====
    async function sendMessage() {
        const message = chatInput.value.trim();
        if (!message) return;

        addMessage('user', message);
        chatInput.value = '';
        chatInput.style.height = 'auto';
        chatInput.disabled = true;
        uploadBtn.disabled = true;

        // [수정] 로딩 애니메이션 추가
        const typingIndicator = document.createElement('div');
        typingIndicator.className = 'message assistant-message';
        typingIndicator.innerHTML = `
            <div class="typing-indicator">
                <span></span><span></span><span></span>
            </div>
        `;
        chatMessages.appendChild(typingIndicator);
        chatMessages.scrollTop = chatMessages.scrollHeight;

        const settings = getSettings();

        try {
            const response = await fetch('http://localhost:8000/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: message,
                    gemma_settings: settings.gemma_settings,
                    model_3d_settings: settings.model_3d_settings
                 })
            });

            // [수정] 응답 받은 후 로딩 애니메이션 제거
            chatMessages.removeChild(typingIndicator);

            if (!response.ok) throw new Error('서버 응답 오류');
            const data = await response.json();

            addMessage('assistant', data.reply, data.duration);

            if (data.image_url) {
                displayImage(data.image_url);
            }

            if (data.model_url) {
                 hideModel();
                 modelPlaceholder.style.display = 'none';
                 showModelLoading(true);
                 const fullModelUrl = `http://localhost:8000${data.model_url}`;
                 currentModelUrl = fullModelUrl;
                 loadModel(currentModelUrl);
            } else {
                 showModelLoading(false);
                 if (!currentModelUrl) {
                     modelPlaceholder.style.display = 'block';
                 }
            }

        } catch (error) {
            // [수정] 에러 발생 시에도 로딩 애니메이션 제거
            if (chatMessages.contains(typingIndicator)) {
                chatMessages.removeChild(typingIndicator);
            }
            console.error('채팅 또는 이미지/모델 생성 오류:', error);
            addMessage('assistant', '죄송합니다, 요청 처리 중 오류가 발생했습니다.');
            showModelLoading(false);
            if (!currentModelUrl) {
                modelPlaceholder.style.display = 'block';
            }
        } finally {
            chatInput.disabled = false;
            uploadBtn.disabled = false;
            chatInput.focus();
        }
    }

    function handleFile(file) {
        if (!file || !file.type.startsWith('image/')) {
            addMessage('assistant', '이미지 파일만 업로드할 수 있습니다.');
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            displayImage(e.target.result);
            addMessage('user', `이미지 '${file.name}'가 업로드되었습니다.`);
            hideModel();
            modelPlaceholder.style.display = 'block';
        };
        reader.readAsDataURL(file);
    }

    // --- 기본 이벤트 리스너 ---
    if (chatForm) {
        chatForm.addEventListener('submit', (e) => {
            e.preventDefault();
            sendMessage();
        });
    }

    if (chatInput) {
        chatInput.addEventListener('keydown', (event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                sendMessage();
            }
        });
        chatInput.addEventListener('input', () => {
            chatInput.style.height = 'auto';
            chatInput.style.height = (chatInput.scrollHeight) + 'px';
        });
    }

    if (uploadBtn) uploadBtn.addEventListener('click', () => fileInput.click());
    if (fileInput) fileInput.addEventListener('change', (e) => { if (e.target.files.length > 0) handleFile(e.target.files[0]); });

    const imageSectionContent = document.querySelector('.image-section .content-area');
    if (imageSectionContent) {
        imageSectionContent.addEventListener('dragover', (e) => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--primary-color)'; });
        imageSectionContent.addEventListener('dragleave', (e) => { e.currentTarget.style.borderColor = 'var(--border-color)'; });
        imageSectionContent.addEventListener('drop', (e) => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--border-color)'; if (e.dataTransfer.files.length > 0) handleFile(e.dataTransfer.files[0]); });
    }

    if (convertBtn) {
        convertBtn.addEventListener('click', async () => {
            if (!currentImageUrl) return;
            convertBtn.disabled = true;

            const { model_3d_settings } = getSettings();
            const queryParams = new URLSearchParams(model_3d_settings).toString();

            try {
                hideModel();
                modelPlaceholder.style.display = 'none';
                showModelLoading(true);

                const response = await fetch(currentImageUrl);
                const blob = await response.blob();
                const formData = new FormData();
                formData.append('file', blob, 'image.png');

                const convertResponse = await fetch(`http://localhost:8000/convert?${queryParams}`, { method: 'POST', body: formData });

                if (!convertResponse.ok) {
                    const err = await convertResponse.text();
                    throw new Error(`3D 변환에 실패했습니다: ${err}`);
                }

                const modelBlob = await convertResponse.blob();
                currentModelUrl = URL.createObjectURL(modelBlob);
                loadModel(currentModelUrl);
                addMessage('assistant', '3D 모델 변환이 완료되었습니다!');
            } catch (error) {
                console.error('3D 변환 오류:', error);
                addMessage('assistant', String(error));
                showModelLoading(false);
                modelPlaceholder.style.display = 'block';
            } finally {
                convertBtn.disabled = false;
            }
        });
    }

    if(downloadImageBtn) downloadImageBtn.addEventListener('click', () => { if (!currentImageUrl) return; const link = document.createElement('a'); link.href = currentImageUrl; link.download = 'generated_image.png'; link.click(); });
    if(downloadModelBtn) downloadModelBtn.addEventListener('click', () => { if (!currentModelUrl) return; const link = document.createElement('a'); link.href = currentModelUrl; link.download = '3d_model.glb'; link.click(); });
    if(resetViewBtn) resetViewBtn.addEventListener('click', () => { if (camera && controls) { controls.reset(); camera.position.set(0, 1, 3); camera.lookAt(0, 0, 0); } });

    // --- 설정 패널 및 뷰어 제어 로직 ---
    function setupSettingsPanel() {
        if (settingsButton) {
            settingsButton.addEventListener('click', () => {
                if (mainContainer) mainContainer.classList.toggle('show-settings');
            });
        }
    }

    function setupSettingsHandlers() {
        if (!autoRotateCheck) return;

        autoRotateCheck.addEventListener('change', () => { if (controls) controls.autoRotate = autoRotateCheck.checked; });
        rotateSpeedSlider.addEventListener('input', () => {
            const speed = parseFloat(rotateSpeedSlider.value);
            if (controls) controls.autoRotateSpeed = speed;
            rotateSpeedValue.textContent = speed.toFixed(1);
        });
        fovSlider.addEventListener('input', () => {
            const fov = parseInt(fovSlider.value);
            if (camera) { camera.fov = fov; camera.updateProjectionMatrix(); }
            fovValue.textContent = fov;
        });
        directionalLightSlider.addEventListener('input', () => {
            const intensity = parseFloat(directionalLightSlider.value);
            if (directionalLight) directionalLight.intensity = intensity;
            directionalLightValue.textContent = intensity.toFixed(1);
        });
        axesHelperCheck.addEventListener('change', () => { if (axesHelper) axesHelper.visible = axesHelperCheck.checked; });

        temperatureSlider.addEventListener('input', () => {
            temperatureValue.textContent = parseFloat(temperatureSlider.value).toFixed(1);
        });
        maxTokensSlider.addEventListener('input', () => {
            maxTokensValue.textContent = maxTokensSlider.value;
        });
    }

    function updateSettingsUI() {
        if(!controls || !camera || !ambientLight || !directionalLight || !axesHelper) return;

        autoRotateCheck.checked = controls.autoRotate;
        axesHelperCheck.checked = axesHelper.visible;
        rotateSpeedSlider.value = controls.autoRotateSpeed;
        rotateSpeedValue.textContent = controls.autoRotateSpeed.toFixed(1);
        fovSlider.value = camera.fov;
        fovValue.textContent = camera.fov;
        directionalLightSlider.value = directionalLight.intensity;
        directionalLightValue.textContent = directionalLight.intensity.toFixed(1);
    }

    // ===== 페이지 초기화 =====
    initializeTheme();
    initThreeJS();
    setupSettingsPanel();
    setupSettingsHandlers();
    setTimeout(updateSettingsUI, 100);
});