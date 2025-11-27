from locust import HttpUser, task, between


class TfgUser(HttpUser):
    wait_time = between(1, 3)

    @task
    def ver_home(self):
        self.client.get("/")

    @task
    def ver_modo_carrera(self):
        self.client.get("/career")

    @task
    def ver_analisis(self):
        self.client.get("/analisis")

    @task
    def ver_empresas(self):
        self.client.get("/empresas")
