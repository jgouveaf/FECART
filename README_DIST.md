# Quantum Tracker - Guia de Distribuição (Stand-alone)

Este guia ensina como gerar a versão executável (.exe) do Quantum Tracker para ser enviada aos seus amigos, clientes ou usuários sem precisarem instalar Python.

## 1. Preparando o Ambiente
Antes de compilar, você precisa instalar a biblioteca `PyInstaller` (ela empacota tudo em um .exe).
Abra um terminal (ou command prompt) na pasta do seu projeto e rode:
```cmd
.\.venv\Scripts\pip install pyinstaller
```

## 2. Compilando o Executável
Você só precisa rodar o script de build que criamos para você!
```cmd
.\.venv\Scripts\python build_exe.py
```
O processo vai demorar **de 3 a 10 minutos** porque ele estará incluindo o Python, o PyTorch, o MediaPipe, o OpenCV e todos os modelos do YOLO e InsightFace dentro da pasta final!

## 3. A Pasta Final (O que enviar para o usuário)
Quando o script terminar, aparecerá uma nova pasta chamada `dist/`.
Dentro dela terá a pasta `QuantumTracker/`.
Essa é a pasta MÁGICA! Ela contém o aplicativo pronto.

**O que você deve fazer:**
1. Navegue até a pasta `dist/`
2. Clique com o botão direito na pasta `QuantumTracker/` e selecione **"Comprimir para arquivo ZIP"** (ou use o WinRAR/7-Zip).
3. Renomeie o arquivo para `QuantumTracker_Windows.zip`

## 4. Distribuindo (Upload)
Faça o upload do arquivo `.zip` gerado para a nuvem:
- **Google Drive**
- **OneDrive**
- **MediaFire**
- **GitHub Releases** (se o código for open-source)

## 5. Como o Usuário (seu amigo/cliente) usa:
O usuário final precisa de passos muito simples:
1. Baixar o `QuantumTracker_Windows.zip`.
2. Clicar com o botão direito e **"Extrair Tudo..."** em qualquer lugar do PC (Área de Trabalho, Documentos, etc).
3. Abrir a pasta extraída e clicar duas vezes no aplicativo **`QuantumTracker.exe`**.

O aplicativo vai abrir! Não precisam instalar absolutamente nada (nenhum pip install, nenhum git, nenhum ambiente virtual). E mais, todos os dados deles (fotos, gestos salvos, configs, logs) serão salvos na própria máquina deles sem misturar com os seus dados! 🚀
