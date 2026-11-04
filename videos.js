for (const section of document.querySelectorAll("[data-video]")) {
  const video = document.createElement("video");
  video.controls = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.hidden = true;
  video.setAttribute("aria-label", section.dataset.label);
  video.addEventListener("loadedmetadata", () => {
    section.querySelector("small").hidden = true;
    video.hidden = false;
  }, { once: true });
  section.append(video);
  video.src = section.dataset.video;
}
