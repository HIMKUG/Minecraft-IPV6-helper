use tauri_build::{Attributes, WindowsAttributes};

fn main() {
    /* V92: 常驻提权 —— 通过 Windows 应用程序清单请求管理员权限（每次启动弹 UAC）。
       等价于 tauri.conf.json 期望的 runAsAdmin，但本 Tauri 版本（2.x）的窗口配置不支持该字段，
       故改用 build.rs 注入 requireAdministrator 清单。保留 Common-Controls v6 依赖以兼容原生对话框/主题。 */
    let windows_attrs = WindowsAttributes::new().app_manifest(r#"
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <dependency>
    <dependentAssembly>
      <assemblyIdentity
        type="win32"
        name="Microsoft.Windows.Common-Controls"
        version="6.0.0.0"
        processorArchitecture="*"
        publicKeyToken="6595b64144ccf1df"
        language="*"
      />
    </dependentAssembly>
  </dependency>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges xmlns="urn:schemas-microsoft-com:asm.v3">
        <requestedExecutionLevel level="requireAdministrator" uiAccess="false" />
      </requestedPrivileges>
    </security>
  </trustInfo>
</assembly>
"#);

    let attrs = Attributes::new().windows_attributes(windows_attrs);

    if let Err(error) = tauri_build::try_build(attrs) {
        eprintln!("{error:#}");
        std::process::exit(1);
    }
}
