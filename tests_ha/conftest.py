import pathlib
import pytest
pytest_plugins = "pytest_homeassistant_custom_component"

@pytest.fixture(autouse=True)
def auto_enable_custom_integrations(enable_custom_integrations):
    import custom_components
    ours = str(pathlib.Path(__file__).parents[1] / "custom_components")
    if ours not in custom_components.__path__:
        custom_components.__path__.append(ours)
    yield
