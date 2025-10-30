from flask import Flask

from .routes import bp as main_bp

try:
    from .career import career_bp
except Exception:  # pragma: no cover
    career_bp = None  # type: ignore[assignment]


def create_app() -> Flask:
    app = Flask(__name__)
    app.register_blueprint(main_bp)
    if career_bp is not None:
        app.register_blueprint(career_bp)
    return app
