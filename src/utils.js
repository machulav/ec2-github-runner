// sorts the array of images by creation date
// the most recent AMIs will appear first

/**
 * sorts the array of images by creation date
 * the most recent AMIs will appear first
 *
 * @param data
 */
function sortByCreationDate(data) {
  const images = data.Images;
  images.sort(function(a,b) {
    const dateA = new Date(a['CreationDate']).getTime();
    const dateB = new Date(b['CreationDate']).getTime();

    return dateA - dateB;
  });
}

module.exports = {
  sortByCreationDate,
}