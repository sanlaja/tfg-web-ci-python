# TFG Web App (Python/Flask) — CI básico

Este repositorio está preparado con:
- **Flask** (backend mínimo)
- **pytest** + **pytest-cov** (tests y cobertura)
- **ruff** + **black** (lint/format)
- **pre-commit** (hooks locales)
- **GitHub Actions** (lint + tests en CI)

## Requisitos
- Python 3.11 o superior
- Git

## Puesta en marcha (Linux/macOS)
```bash
git init
python -m venv .venv
source .venv/bin/activate
pip install -r requirements-dev.txt
pre-commit install
pytest
python run.py
```

## Puesta en marcha (Windows PowerShell)
```powershell
git init
py -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
pre-commit install
pytest
py run.py
```

## Estructura
```
app/
  __init__.py
  routes.py
tests/
  test_health.py
.github/workflows/ci.yml
```

## Rutas
- `GET /health` -> `{"status":"ok"}`

## CI en GitHub
1. Crea el repo en GitHub y sube este contenido.
2. La acción **CI** se ejecutará automáticamente en cada `push` y `pull_request`:
   - ruff (lint)
   - black --check (formato)
   - pytest con cobertura

## Formato y lint
```bash
ruff check .
black .
```

## Cobertura
Tras `pytest --cov`, se genera `coverage.xml`. Puedes configurarlo para servicios de cobertura si lo deseas.

---
Generado el 2025-09-24.
