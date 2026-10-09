use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct Credentials {
    username: String,
    password: String,
}

#[cfg(windows)]
mod vault {
    use super::Credentials;
    use windows::{
        core::{w, PWSTR},
        Win32::Security::Credentials::*,
    };
    const TARGET: windows::core::PCWSTR = w!("proxytools/management-credentials");
    pub fn read() -> Result<Option<Credentials>, String> {
        unsafe {
            let mut pointer = std::ptr::null_mut();
            if let Err(error) = CredReadW(TARGET, CRED_TYPE_GENERIC, None, &mut pointer) {
                if error.code().0 as u32 == 0x80070490 {
                    return Ok(None);
                }
                return Err("Could not read Windows Credential Manager.".into());
            }
            let credential = &*pointer;
            if credential.CredentialBlob.is_null() || credential.CredentialBlobSize == 0 {
                CredFree(pointer.cast());
                return Err("Stored management credentials are empty.".into());
            }
            let data = std::slice::from_raw_parts(
                credential.CredentialBlob,
                credential.CredentialBlobSize as usize,
            );
            let result = serde_json::from_slice(data)
                .map(Some)
                .map_err(|_| "Stored management credentials are invalid.".into());
            CredFree(pointer.cast());
            result
        }
    }
    pub fn write(value: &Credentials) -> Result<(), String> {
        let mut data =
            serde_json::to_vec(value).map_err(|_| "Could not encode management credentials.")?;
        let mut username: Vec<u16> = value.username.encode_utf16().chain(Some(0)).collect();
        let credential = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: PWSTR(TARGET.0.cast_mut()),
            CredentialBlobSize: data
                .len()
                .try_into()
                .map_err(|_| "Management credentials are too large.")?,
            CredentialBlob: data.as_mut_ptr(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            UserName: PWSTR(username.as_mut_ptr()),
            ..Default::default()
        };
        let result = unsafe { CredWriteW(&credential, 0) }
            .map_err(|_| "Could not save credentials in Windows Credential Manager.".to_string());
        data.fill(0);
        result
    }
    pub fn delete() -> Result<(), String> {
        match unsafe { CredDeleteW(TARGET, CRED_TYPE_GENERIC, None) } {
            Ok(()) => Ok(()),
            Err(error) if error.code().0 as u32 == 0x80070490 => Ok(()),
            Err(_) => Err("Could not delete credentials from Windows Credential Manager.".into()),
        }
    }
}

#[tauri::command]
pub fn read_management_credentials() -> Result<Option<Credentials>, String> {
    #[cfg(windows)]
    {
        vault::read()
    }
    #[cfg(not(windows))]
    {
        Ok(None)
    }
}
#[tauri::command]
pub fn save_management_credentials(credentials: Credentials) -> Result<(), String> {
    #[cfg(windows)]
    {
        vault::write(&credentials)?;
    }
    #[cfg(not(windows))]
    {
        let _ = credentials;
        return Err(
            "Persistent credentials require Windows Credential Manager on this platform.".into(),
        );
    }
    crate::proxy_transport::clear_management_sessions();
    Ok(())
}
#[tauri::command]
pub fn delete_management_credentials() -> Result<(), String> {
    #[cfg(windows)]
    {
        vault::delete()?;
    }
    crate::proxy_transport::clear_management_sessions();
    Ok(())
}
