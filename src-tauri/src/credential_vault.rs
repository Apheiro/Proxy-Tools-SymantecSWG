//! Shared Windows Credential Manager storage. Secrets never appear in errors.
#[cfg(windows)]
mod windows_vault {
    use windows::{core::PWSTR, Win32::Security::Credentials::*};
    fn wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(Some(0)).collect()
    }
    pub fn read(target: &str) -> Result<Option<Vec<u8>>, String> {
        let target = wide(target);
        unsafe {
            let mut pointer = std::ptr::null_mut();
            if let Err(error) = CredReadW(
                windows::core::PCWSTR(target.as_ptr()),
                CRED_TYPE_GENERIC,
                None,
                &mut pointer,
            ) {
                if error.code().0 as u32 == 0x80070490 {
                    return Ok(None);
                }
                return Err("Could not read Windows Credential Manager.".into());
            }
            let credential = &*pointer;
            let value = if credential.CredentialBlob.is_null() || credential.CredentialBlobSize == 0
            {
                Err("Stored credential is empty.".into())
            } else {
                Ok(Some(
                    std::slice::from_raw_parts(
                        credential.CredentialBlob,
                        credential.CredentialBlobSize as usize,
                    )
                    .to_vec(),
                ))
            };
            CredFree(pointer.cast());
            value
        }
    }
    pub fn write(target: &str, data: &mut [u8], username: &str) -> Result<(), String> {
        let mut target = wide(target);
        let mut username = wide(username);
        let credential = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: PWSTR(target.as_mut_ptr()),
            UserName: PWSTR(username.as_mut_ptr()),
            CredentialBlobSize: data
                .len()
                .try_into()
                .map_err(|_| "Credential is too large.")?,
            CredentialBlob: data.as_mut_ptr(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            ..Default::default()
        };
        unsafe { CredWriteW(&credential, 0) }
            .map_err(|_| "Could not save credential in Windows Credential Manager.".into())
    }
    pub fn delete(target: &str) -> Result<(), String> {
        let target = wide(target);
        match unsafe {
            CredDeleteW(
                windows::core::PCWSTR(target.as_ptr()),
                CRED_TYPE_GENERIC,
                None,
            )
        } {
            Ok(()) => Ok(()),
            Err(error) if error.code().0 as u32 == 0x80070490 => Ok(()),
            Err(_) => Err("Could not delete credential from Windows Credential Manager.".into()),
        }
    }
}
pub fn read(target: &str) -> Result<Option<Vec<u8>>, String> {
    #[cfg(windows)]
    {
        windows_vault::read(target)
    }
    #[cfg(not(windows))]
    {
        let _ = target;
        Ok(None)
    }
}
pub fn write(target: &str, mut data: Vec<u8>, username: &str) -> Result<(), String> {
    #[cfg(windows)]
    let result = windows_vault::write(target, &mut data, username);
    #[cfg(not(windows))]
    let result = {
        let _ = (target, username);
        Err("Persistent credentials require Windows Credential Manager on this platform.".into())
    };
    data.fill(0);
    result
}
pub fn delete(target: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        windows_vault::delete(target)
    }
    #[cfg(not(windows))]
    {
        let _ = target;
        Ok(())
    }
}
