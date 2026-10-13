use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct Credentials {
    username: String,
    password: String,
}
const TARGET: &str = "proxytools/management-credentials";

#[tauri::command]
pub fn read_management_credentials() -> Result<Option<Credentials>, String> {
    crate::credential_vault::read(TARGET)?
        .map(|mut data| {
            let result = serde_json::from_slice(&data)
                .map_err(|_| "Stored management credentials are invalid.".into());
            data.fill(0);
            result
        })
        .transpose()
}
#[tauri::command]
pub fn save_management_credentials(credentials: Credentials) -> Result<(), String> {
    let data =
        serde_json::to_vec(&credentials).map_err(|_| "Could not encode management credentials.")?;
    crate::credential_vault::write(TARGET, data, &credentials.username)?;
    crate::proxy_transport::clear_management_sessions();
    Ok(())
}
#[tauri::command]
pub fn delete_management_credentials() -> Result<(), String> {
    crate::credential_vault::delete(TARGET)?;
    crate::proxy_transport::clear_management_sessions();
    Ok(())
}
