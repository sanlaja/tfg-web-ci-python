import matplotlib

# Force a headless backend so Matplotlib never opens GUI windows on the server.
matplotlib.use("Agg")

from flask import Flask

from .routes import bp as main_bp
from .career import career_bp


def create_app() -> Flask:
    app = Flask(__name__)
    app.register_blueprint(main_bp)
    app.register_blueprint(career_bp)
    return app
