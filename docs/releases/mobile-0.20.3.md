# PI Mobile 0.20.3

- On phones whose system pauses apps in the background (ColorOS, OriginOS,
  HyperOS, EMUI/MagicOS), notifications used to arrive only after PI Mobile
  was opened. The app now detects this. Sessions and Activity then name the
  switch to turn on for your phone brand.
- Phones known to pause background apps get that guidance up front in
  Activity. The notice and Me can ask Android for the battery-optimization
  exemption in one tap.
- Notification permission and battery status refresh after returning from a
  system dialog.

These phones also need the vendor's background permission for notifications
to arrive in the background. On OPPO or OnePlus, open App settings → Battery
usage and turn on Allow full background activity and Allow auto launch.

Compatible with PI Desktop 0.20.2; no desktop update or MC deployment is
required. Android versionCode 9 keeps the existing package and signing
identity, so it installs over earlier versions.
